# SDD-0 — Arquitetura geral

v0.1 · 2026-09-01 · depende de: PRB.md

## 1. Visão em uma frase

Camada de tradução bidirecional entre usuário e LLM do chat, implementada **exclusivamente nos eventos de ciclo de vida de mensagem do SillyTavern**, com inglês como texto canônico (`mes`) e a língua do usuário como texto de exibição (`extra.display_text`, mecanismo nativo do ST).

## 2. Fluxo de dados

```
USUÁRIO (escreve PT-BR)
   │  envio
   ▼
[MESSAGE_SENT] (awaited, antes da geração)
   │  lib/translate: PT-BR → EN  (modelo tradutor OpenAI-compatible)
   ▼
mes = EN · extra.display_text = PT-BR · extra.translation = {proveniência}
   │
   ▼
Geração do ST ──► prompt montado nativamente em EN (zero interceptação)
   │
   ▼
LLM do chat responde EN (streaming visível: placeholder "translating…")
   │
   ▼
[MESSAGE_RECEIVED] (awaited, na finalização — streaming, não-streaming e swipe)
   │  lib/translate: EN → PT-BR
   ▼
mes = EN (salvo) · extra.display_text = PT-BR
   │
   ▼
UI do ST renderiza display_text (nativo: `messageFormatting(display_text || mes)`)
USUÁRIO (lê PT-BR)
```

## 3. Componentes e responsabilidade

| Componente | Arquivo | Responsabilidade | SDD |
|---|---|---|---|
| Pipeline de mensagens | `index.js` | Handlers dos eventos, mutação de mensagens, orquestração, status UI | SDD-2 |
| Serviço de tradução | `lib/translate.js` | Cliente OpenAI-compatible, prompts, retry/backoff, `testConnection` | SDD-1 |
| Proteção de conteúdo | `lib/protect.js` | Extração/restauração de código, URLs, nomes (placeholders) | SDD-1 |
| Settings & UI | `settings.html`, `style.css`, `index.js` (render) | Aba de configuração, botões por mensagem, chip de status | SDD-3 |

## 4. Fatos da fonte do ST que sustentam o design (verificados, release 8172dcd 2026-07-07)

1. `getMessageTextHTML` renderiza `message.extra?.display_text || message.mes` (script.js:2470) — o display alternativo é suportado nativamente; o prompt usa `mes`.
2. `MESSAGE_SENT` é emitido com `await` imediatamente após salvar a mensagem do usuário e antes da geração (script.js:5851/5858) — mutar `mes` no handler entra no prompt como EN.
3. `MESSAGE_RECEIVED` é emitido com `await` na finalização: streaming (`finalizeIntermediaryMessage`, script.js:3740) e não-streaming (6632/6657/6679/6722); swipe também passa por finalize (apenas `impersonate` é excluído).
4. `MESSAGE_EDITED` (8345), `MESSAGE_UPDATED` (8277/8371), `MESSAGE_SWIPED` (10255) cobrem edição e swipe.
5. `clearMessageData` deleta `extra.display_text` (10062, chamado em 10085/10352) — regeneração limpa o display sozinha; a pipeline só re-traduz no `MESSAGE_RECEIVED` seguinte.
6. `IMPERSONATE_READY` entrega o texto sugerido do impersonate — hook opcional para FR-12.

## 5. Princípios de design

1. **Zero interceptação de prompt.** O EN canônico faz o ST montar o prompt certo sozinho. Valem os mesmos caminhos para chat completions, text completions, summarize, vectors etc.
2. **Idempotência por proveniência.** Toda mutação marca `extra.translation = { lang, direction, ts, model }` antes de alterar texto. Handlers ignoram mensagens já marcadas — protege contra loops (ex.: `MESSAGE_UPDATED` disparado pelo nosso próprio save) e re-tradução dupla.
3. **Nunca perder texto do usuário.** Invariante: `mes` só é sobrescrito se o conteúdo anterior estiver preservado em `extra.display_text` (e vice-versa na edição). Boundary "Never" do PRB.
4. **Handlers não lançam.** Falha de tradução vira estado de UI (toast/link de retry), nunca exceção propagada para o pipeline do ST.
5. **Módulos puros testáveis.** `lib/translate.js` e `lib/protect.js` não tocam em DOM nem em `getContext` — recebem configuração por parâmetro.

## 6. Modelo de dados (mensagem do chat)

```jsonc
// mensagem do usuário, após a pipeline
{
  "name": "User",
  "is_user": true,
  "mes": "Hey, everything alright?",                      // canônico EN → vai pro prompt
  "extra": {
    "display_text": "E aí, tudo bem?",                    // o que o usuário vê
    "translation": { "lang": "pt-BR", "direction": "user→en", "model": "…", "ts": 1760000000 }
  }
}
// mensagem da LLM, após a pipeline: mes = EN gerado, display_text = tradução
```

- Settings da extensão: `extension_settings.translationLayer` (schema no SDD-3).
- Chat exportado/branch contém os dois textos — portável por definição (o `mes` é EN, o display viaja no `extra`).

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Latência: 1 round-trip extra por mensagem | Modelo flash/local recomendado nas settings + placeholder "translating…" (FR-5) |
| Tradutora muda marcação (`*…*`) ou placeholders de código | Prompt rígido + `lib/protect.js` + fallback: se placeholder sumir no retorno, devolve segmento original (SDD-1 §5) |
| Loop de eventos (nosso save re-dispara handler) | Proveniência `extra.translation` + handlers idempotentes |
| Diálogo de edição do ST carregar `mes` (EN) em vez de display | Verificar no implementation; se carregar `mes`, adaptar handler de `MESSAGE_EDITED` (SDD-2 §4.3 define as duas direções) |
| Custo de API do tradutor | Visível no "Test connection"; tradução full-message só quando necessário; FR-5 já evita retradução por chunk |
