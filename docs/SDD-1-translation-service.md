# SDD-1 — Serviço de tradução (`lib/translate.js` + `lib/protect.js`)

v0.1 · 2026-09-01 · depende de: SDD-0

## 1. Contrato público

```js
// lib/translate.js — módulo puro: recebe config, não toca em DOM/context
createTranslationService(config)
  → {
      translate(text, { direction, language }) → Promise<string>,   // direction: 'user→en' | 'en→user'
      testConnection() → Promise<{ ok: true, latencyMs } | { ok: false, error: Classification }>,
    }

// config = { baseUrl, apiKey, model, language, translateReasoning }

// lib/protect.js
protect(text)  → { masked, restore(translated) → string }
// extrai código/URLs, substitui por placeholders ⟦TL0⟧, ⟦TL1⟧…, e recoloca após a tradução
```

## 2. Chamada HTTP (OpenAI-compatible)

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
{
  "model": "{model}",
  "temperature": 0.2,          // tradução: determinístico o suficiente, margem pra estilo
  "stream": false,             // full-message; sem tradução por chunk no MVP
  "max_tokens": max(1024, round(len(text)/3) * 2),   // folga p/ nunca truncar; ajustar em teste
  "messages": [ {system}, {user: <texto mascarado>} ]
}
```

- Timeout: 30 s por tentativa (AbortController).
- `baseUrl` normalizado: sem trailing slash; se o usuário colar URL terminando em `/chat/completions`, aceitar e não duplicar.
- Resposta: `choices[0].message.content`, `trim()`. Conteúdo vazio → tratado como erro de tradução.

## 3. Prompts

### 3.1 System prompt — direção `user→en`

```
You are a translation engine. Translate the user's message into English.
Rules:
- Return ONLY the translation. No preamble, no quotes, no commentary.
- If the message is already in English, return it unchanged.
- Preserve formatting exactly: *asterisks*, "quotes", line breaks, lists, markdown.
- Never translate tokens that look like ⟦TL0⟧ ⟦TL1⟧ … — copy them verbatim.
- Translate tone, slang and style faithfully (keep it casual if casual).
```

### 3.2 System prompt — direção `en→user`

```
You are a translation engine. Translate the user's message into {language}.
Rules:
- Return ONLY the translation. No preamble, no quotes, no commentary.
- If the message is already in {language}, return it unchanged.
- Preserve formatting exactly: *asterisks*, "quotes", line breaks, lists, markdown.
- Never translate tokens that look like ⟦TL0⟧ ⟦TL1⟧ … — copy them verbatim.
- Keep proper names, character names, onomatopoeia and emojis exactly as written.
- Translate tone, slang and style faithfully.
```

### 3.3 Mensagens longas

Sem chunking no MVP: mensagem inteira num request. `max_tokens` com folga; se terminar por `finish_reason: length`, tratar como erro (retry 1× com max_tokens dobrado; se persistir, falha classificada).

## 4. Retry e classificação de erros (FR-8)

```
tentativas: até 3 (1 + 2 retries), backoff exponencial 1s / 3s (jitter ±20%)
classificação:
  network      → timeout, DNS, conexão recusada            (retry)
  rate_limit   → HTTP 429                                  (retry com backoff maior: 3s / 9s)
  auth         → HTTP 401/403                              (NÃO retry; erro imediato p/ UI)
  server       → HTTP 5xx                                  (retry)
  bad_output   → resposta vazia/truncada irrecoverável     (retry 1×)
  unknown      → demais                                    (retry)
após esgotar: lança TranslationError { classification, attempt, cause } — quem chama decide UX
```

- `testConnection()`: envia `Translate to English: "olá"` e valida resposta não-vazia; mede latência; classifica auth vs network pra mensagem de erro da UI (SC-9).

## 5. Proteção de conteúdo (`lib/protect.js`, FR-7/SC-6)

Extração **antes** do envio ao tradutor, restauração **depois**:

1. Padrões extraídos em ordem: fenced code blocks (```…```), inline code (`…`), URLs/http(s)://…, e nada mais no MVP (nomes e onomatopeias ficam por conta do prompt §3.2 — instrução explícita; fallback abaixo cobre desvios).
2. Cada ocorrência vira placeholder `⟦TL{n}⟧` (colchetes unicode improvéveis no texto; nunca usados por markdown).
3. `restore(translated)`:
   - placeholder presente → recoloca o original byte a byte;
   - **placeholder ausente ou alterado** (tradutor apagou/reescreveu) → fallback: devolve o segmento original no lugar mais provável (posição relativa) e sinaliza `warnings[]` para log; nunca devolve texto sem o segmento.
4. Idempotência: `restore` não reprocessa placeholders válidos já restaurados.

## 6. Raciocínio (`<think>`, FR-7/SC-8)

- Default OFF. Ligado: `translate()` recebe o texto do bloco de raciocínio separadamente (SDD-2 §4.2), mesma direção `en→user`, mesma proteção; resultado volta para o campo de raciocínio do display, sem tocar no `mes`/prompt.
- Blocos inline `<think>…</think>` no corpo: extraídos como segmento protegido (não traduzidos, movidos intactos).

## 7. Configuração consumida

| Campo | Uso |
|---|---|
| `baseUrl`, `apiKey`, `model` | request HTTP |
| `language` | prompt §3.2 e tolerância "já está na língua" |
| `translateReasoning` | gate do §6 |

Sem configuração completa (baseUrl/model vazios) → `translate()` falha com `auth`-like `not_configured`; a UI desabilita a extensão com aviso claro (SDD-3 §5).
