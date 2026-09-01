# Todo — st-translation-layer v0.1

- [x] Task 1: `lib/protect.js` — proteção de conteúdo
  - Acceptance: fenced code, inline code e URLs viram `⟦TLn⟧`; `restore` recoloca byte a byte; placeholder perdido → segmento re-anexado + warning.
  - Verify: round-trip testado (node): ida-e-volta byte-perfect; recuperação de placeholder perdido OK. ✔
  - Files: `lib/protect.js`
- [x] Task 2: `lib/translate.js` — serviço de tradução
  - Acceptance: `translate(text, direction)` com retry 3×/backoff, classificação de erro, `testConnection()`; prompts conforme SDD-1.
  - Verify: sintaxe OK; teste funcional depende de endpoint real (SC-9 com o usuário). ⏳ pendente teste com tradutora real
  - Files: `lib/translate.js`
- [x] Task 3: UI shell — `settings.html` + `style.css`
  - Acceptance: aba com todos os campos do SDD-3; classes prefixadas `st-tl-`.
  - Verify: servido 200; renderização visual pendente de F5 do usuário. ⏳
  - Files: `settings.html`, `style.css`
- [x] Task 4: `index.js` — pipeline completo
  - Acceptance: FR-1..FR-11 implementados (saída com popup de falha bloqueante, entrada, edição com swap de textarea, swipe/regen via detecção de stale por hash, botões por mensagem, máscara de stream gated por tipo de geração, toggle master, settings).
  - Verify: sintaxe OK; imports resolvem (extensions.js/script.js/popup.js → 200). SC-1..SC-8 manuais pendentes. ⏳
  - Files: `index.js`
- [x] Task 5: Deploy + smoke
  - Acceptance: symlink em `data/default-user/extensions/st-translation-layer`; manifest/index/lib/settings/css servidos (200).
  - Verify: curl OK ✔; carregamento no navegador pendente — o browser embutido não anexou (webview not ready); usuário dá F5 no ST.
  - Files: symlink fora do repo

## Pendências pós-implementação
- [x] F5 no ST e conferir "Translation Layer" no painel Extensions (sem erros no console). ✔ Verificado via chrome-devtools-mcp em Chrome limpo: 11 elementos de settings no DOM, zero erros de console, screenshot validado (2026-09-01). Bugs de boot corrigidos: (1) template sem prefixo `third-party/`; (2) `loadExtensionSettings()` chamado pela extensão recursava o loader do app (padrão errado do scaffold) — removido.
- [ ] Configurar tradutora (Base URL/key/model) e rodar "Test connection" (SC-9).
- [ ] Checklist SC-1..SC-10 (docs/PRB.md §5).
- [ ] FR-12 (IMPERSONATE_READY) — fora deste ciclo por decisão de plano.
