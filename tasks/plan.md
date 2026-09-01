# Plan — st-translation-layer v0.1 (MVP)

Specs: `../docs/PRB.md`, `../docs/SDD-0..3`. Ambiente: ST clone em `../SillyTavern` (release 8172dcd, rodando em 127.0.0.1:8000), deploy via symlink em `data/default-user/extensions/`.

## Ordem de implementação (dependência)

1. `lib/protect.js` — puro, sem dependências (placeholders ⟦TLn⟧ para código/URLs).
2. `lib/translate.js` — cliente OpenAI-compatible + prompts + retry/classificação + `testConnection`; depende de protect.
3. `settings.html` + `style.css` — casca de UI (aba, chip, máscara de stream, botões).
4. `index.js` — wiring completo: settings, handlers de eventos, botões por mensagem, edit-swap, popup de falha.
5. Deploy + smoke: symlink, `curl` no manifest servado, load no navegador.

## Decisões de implementação consolidadas (verificadas na fonte em 2026-09-01)

- Imports de `../../../../script.js`: `eventSource, event_types, saveSettingsDebounced, saveChatConditional, updateMessageBlock, getContext` — todos exportados (script.js:297+, 9352, 1972, 469).
- Popup com botões custom: `callGenericPopup(msg, POPUP_TYPE.CONFIRM, '', { okButton: 'Retry', cancelButton: 'Send untranslated' })` (popup.js:41).
- Raciocínio: string em `message.extra.reasoning`.
- Edição: diálogo carrega `mes` (EN) → index.js troca o textarea para `display_text` (click delegado em `.mes_edit` + poll de `#curEditTextarea`) e grava baseline em runtime; `MESSAGE_EDITED` faz a mutação de dados, `MESSAGE_UPDATED` faz o re-render final (`updateMessageBlock`).
- Bloqueio de envio em falha: handler awaited + popup — a geração só prossegue quando o usuário escolhe (Retry / Send untranslated). Sem throw, sem rollback.
- Botões por mensagem: append em `.extraMesButtons` do bloco + clique delegado; decoração via `USER_MESSAGE_RENDERED`/`CHARACTER_MESSAGE_RENDERED` + passada em `CHAT_CHANGED` (fallback timeout).
- Máscara de stream: classe `st-tl-mask` em `#chat` durante geração (toggle EN-off), removida em `MESSAGE_RECEIVED`/`GENERATION_STOPPED`/`GENERATION_ENDED`.

## Fora deste ciclo

FR-12 (impersonate), backfill, fallback para conexão do ST, vitest (ver `../docs/PRB.md` §4).

## Verificação

- `curl -s http://127.0.0.1:8000/scripts/extensions/third-party/st-translation-layer/manifest.json` → 200.
- Smoke manual SC-1..SC-10 (checklist em `../docs/PRB.md` §5) com tradutora real configurada pelo usuário.
