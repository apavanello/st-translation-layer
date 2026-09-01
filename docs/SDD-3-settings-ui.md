# SDD-3 — Settings & UI

v0.1 · 2026-09-01 · depende de: SDD-0, SDD-2

## 1. O que aparece pra o usuário

1. **Aba da extensão** no painel Extensions do ST (template `settings.html` via `renderExtensionTemplateAsync`).
2. **Dois botões por mensagem** no footer de extras: "view original" (olho) e "re-translate" (setas circulares) — ícones SVG inline, tooltips.
3. **Chip de status "translating…"** no bloco da mensagem durante round-trips.
4. **Toast** para falhas de saída (botões "Try again" / "Send untranslated").
5. **Link "translation failed — retry"** dentro da mensagem quando tradução de entrada falha.

Strings de UI em EN (PRB §4 — ecossistema/tutorial em EN), exceto a tradução das mensagens em si.

## 2. Schema de settings

```js
extension_settings['st-translation-layer'] = {   // chave = slug (Q11)
  enabled: true,                 // toggle master (FR-11)
  baseUrl: '',                   // ex.: http://localhost:11434/v1 (Ollama), https://api.openai.com/v1
  apiKey: '',                    // guardado no mecanismo padrão do ST (extension_settings)
  model: '',                     // ex.: gemini-2.5-flash, gpt-4o-mini, qwen2.5:7b
  language: 'pt-BR',             // língua do usuário — NUNCA derivada da UI do ST (FR-9)
  translateReasoning: false,     // FR-7/SC-8, default OFF
  showOriginalDuringStream: false, // FR-5, default OFF
}
```

- Chaves de DOM com prefixo `st-translation-layer-` (ex.: `#st-translation-layer-base-url`).
- Migração: defaults aplicados por `Object.assign(defaults, saved)` — chaves novas nunca quebram salvas antigas; renomear chave = "Ask first" (PRB §11).

## 3. Aba de settings — layout

```
┌ Translation Layer ──────────────────────────── [ ● enabled ] ┐
│ Translator (OpenAI-compatible)                              │
│   Base URL   [ https://api.openai.com/v1               ]     │
│   API key    [ ••••••••••••        ] [Test connection]      │
│   Model      [                       ]                      │
│                                                             │
│ Language                                                     │
│   User language [ Portuguese (Brazil) ▾ ]  (+ free text)    │
│                                                             │
│ Behavior                                                     │
│   [ ] Translate reasoning blocks (<think>)                  │
│   [ ] Show original (EN) while streaming                    │
└─────────────────────────────────────────────────────────────┘
```

- Dropdown de línguas: `pt-BR, pt-PT, es, fr, de, it, ru, ja, ko, zh-CN, pl, nl, tr, uk` + opção "Other…" que abre campo livre (validação: não-vazio).
- **Test connection** (SC-9): chama `testConnection()` (SDD-1 §4); resultado inline: `✓ OK (840 ms)` / `✗ Auth failed — check API key` / `✗ Network error — check Base URL`.
- Se `enabled=true` e baseUrl/model vazios: faixa de aviso "Translator not configured — messages will not be translated" e a pipeline trata como `not_configured` (SDD-1 §7).

## 4. Botões por mensagem

- Inseridos no container de extras do footer da mensagem (padrão usado por extensões nativas; seletor a confirmar na implementação — registrar aqui quando confirmado).
- `view original` (FR-10/US-4): alterna o DOM do corpo da mensagem entre display e `mes`; estado no `runtime.viewingOriginal` (SDD-2 §6); sem persistir. Em mensagens sem `display_text` o botão fica oculto.
- `re-translate` (FR-6): re-executa a direção registrada em `extra.translation.direction`, sobrescreve o display (entrada) ou o mes (saída); chip de status durante.
- Ocultar ambos quando: toggle master OFF, mensagem `is_system`, ou mensagem sem `extra.translation` (exceto retry-link de falha).

## 5. Status visual (FR-5)

- `.st-tl-chip` — chip discreto ("translating…") posicionado no canto do bloco da mensagem; entra no início do handler, sai no fim (sucesso ou falha).
- Streaming com EN-off: overlay CSS (`.st-tl-mask`) cobre o corpo da mensagem durante o stream (o conteúdo EN renderizado fica oculto); removido quando a tradução é aplicada ou quando o toggle EN-on está ativo.

## 6. Estilos (`style.css`)

- Prefixo `st-tl-` em toda classe; cores via variáveis do ST (`var(--SmartThemeQuoteColor)` etc.) para respeitar temas.
- Sem !important; escopo máximo possível por classe própria (não estilizar elementos nativos do ST).

## 7. Acessos ao ST usados pela UI

| Necessidade | API | Risco |
|---|---|---|
| Settings | `extension_settings`, `loadExtensionSettings`, `saveSettingsDebounced` | padrão |
| Template | `renderExtensionTemplateAsync('third-party/st-translation-layer', 'settings')` | padrão |
| Toast com botões | `toastr` global do ST (buttons option) | padrão |
| Contexto | `getContext()` (chat, eventSource, save/reload) | SDD-2 §5 |
