# PRB — Translation Layer (`st-translation-layer`)

Product Requirements Brief · v0.1 · 2026-09-01
Fonte: brainstorm fechado em `../../brainstorms/2026-09-01-st-bidirectional-translation.md` (Q1–Q12 + fatos verificados na fonte do ST).

## 1. Objetivo

**Problema.** Usuários não-anglófonos (ex.: PT-BR) conversam com LLMs num prompt misto: cards, world info e persona em EN, mas histórico e mensagens em PT-BR. Isso degrada a qualidade da resposta — em especial em modelos que raciocinam em EN — e encarece a coerência do roleplay.

**Solução.** Extensão do SillyTavern que garante que **a LLM do chat só enxerga inglês**, enquanto o usuário lê e escreve na própria língua. A tradução nas duas vias é feita por um modelo tradutor configurável (conexão OpenAI-compatible própria da extensão).

**Usuário-alvo.** Roleplayer/usuário de ST cujos cards e configurações já estão em EN e que quer conversar na língua nativa sem poluir o prompt.

**Visão de sucesso.** O prompt enviado à LLM contém apenas EN (para mensagens criadas com a extensão ativa); a UI exibe apenas a língua do usuário; o usuário nunca percebe o EN, exceto se pedir para ver.

## 2. User stories

- US-1: Como usuário PT-BR, quero digitar em PT-BR para que a LLM receba a mensagem em EN, mantendo a qualidade do modelo.
- US-2: Como usuário PT-BR, quero ler as respostas da LLM em PT-BR, sem que o histórico guardado (e o prompt) deixe de ser EN.
- US-3: Como usuário, quero editar uma mensagem em PT-BR e que a versão EN do histórico seja re-traduzida automaticamente.
- US-4: Como usuário, quero alternar o "ver original" por mensagem para conferir o que efetivamente foi parar no prompt.
- US-5: Como usuário, quero que uma falha da tradutora nunca corrompa o chat: saída bloqueia com opção explícita de degradar; entrada mostra EN com link de retry.

## 3. Requisitos funcionais

| ID | Requisito | Origem |
|----|-----------|--------|
| FR-1 | Texto canônico (`mes`) sempre EN; língua do usuário em `extra.display_text` (render nativo do ST). Sem interceptação de prompt. | Q1 |
| FR-2 | Tradutora própria: conexão OpenAI-compatible (Base URL, API key, modelo) configurada na aba da extensão, independente da conexão do chat. | Q2 |
| FR-3 | Saída: ao enviar mensagem do usuário, traduz user-lang→EN **antes** da mensagem entrar na geração (`MESSAGE_SENT`, awaited). | Q1, Q3 |
| FR-4 | Entrada: ao finalizar resposta (inclusive swipe/regen), traduz EN→user-lang e anexa em `extra.display_text` (`MESSAGE_RECEIVED`, awaited). | Q1 |
| FR-5 | Streaming: placeholder "translating…" durante o stream; exibe a tradução completa ao final. Toggle "mostrar EN durante o stream". | Q3 |
| FR-6 | Edição/swipe/regen re-traduz automaticamente o lado alterado; botão "re-translate" por mensagem. | Q5 |
| FR-7 | Regras de conteúdo: traduz prosa/diálogo preservando marcação (`*…*`, `"…"`) e formatação; preserva byte a byte código, URLs, nomes próprios, emojis e onomatopeias; raciocínio (`<think>`) só traduz se toggle ligado (default OFF). | Q6 |
| FR-8 | Falhas: retry 2–3× com backoff. Saída: bloqueia envio com toast "Try again"/"Send untranslated". Entrada: salva EN, exibe EN + link "translation failed — retry". | Q7 |
| FR-9 | Língua do usuário: setting própria na aba da extensão (dropdown + campo livre, default pt-BR), nunca derivada da UI do ST. Tolerância: input já na língua-alvo retorna inalterado. | Q9 |
| FR-10 | UI: toggle master; por mensagem "view original" (só visual) e "re-translate"; chip de status "translating…"; botão "Test connection" nas settings. | Q10, Q5 |
| FR-11 | Toggle master desliga 100% da interceptação (ST vanilla). | Q10 |
| FR-12 | (Should-have, não bloqueia release) Traduzir a sugestão do impersonate (`IMPERSONATE_READY`) de EN→user-lang antes de cair na caixa de envio. | verificação na fonte |

## 4. Não-metas (fora do MVP)

- Backfill/tradução de chats legados (fase 2, sem compromisso — Q8).
- Tradução de persona, author's note, main prompt e outros campos de prompt (responsabilidade do usuário — Q4).
- Interceptação/mutação do prompt montado (desnecessária por design — Q1).
- Slash commands e tradução de chunks ao vivo durante o stream (Q3/C descartado no MVP).
- Fallback "usar conexão atual do ST" para a tradutora (Q2/C, fase 2).
- UI/detecção multi-idioma da interface da extensão (strings em EN).

## 5. Critérios de sucesso (testáveis)

- SC-1: Com a extensão ativa, enviar "Olá, tudo bem?" produz no chat salvo: `mes` em EN e `extra.display_text` em PT-BR; o prompt inspecionado (prompt manager/chat completion inspection) contém somente a versão EN.
- SC-2: Resposta da LLM fica com `mes` EN e display na língua do usuário; nenhum EN visível na UI com os defaults.
- SC-3: Editar o texto exibido (PT-BR) re-traduz e atualiza o `mes` EN correspondente.
- SC-4: Swipe/regeneração gera nova tradução de display; regeneração não herda display antigo (`clearMessageData` já limpa `extra.display_text` — verificado na fonte).
- SC-5: Tradutora indisponível (endpoint desligado): saída faz retries e então bloqueia com toast contendo "Try again" e "Send untranslated"; entrada salva EN e mostra link de retry por mensagem.
- SC-6: Mensagem contendo bloco de código, URL, nome próprio e onomatopeia: todos preservados byte a byte após ida-e-volta PT-BR→EN→PT-BR.
- SC-7: Toggle master OFF: enviar/receber/editar comporta-se como ST vanilla (nenhum campo extra criado).
- SC-8: Com toggle de raciocínio OFF (default), blocos `<think>` permanecem EN; ligando, passa a traduzir.
- SC-9: "Test connection" com credenciais válidas retorna sucesso rápido; com URL/key inválida retorna erro identificável (auth vs rede).
- SC-10: Trocar a língua nas settings muda a língua das novas traduções sem depender do idioma da UI do ST.

## 6. Tech stack

- SillyTavern (release ≥ commit 8172dcd / 2026-07) rodando via git clone local.
- Extensão third-party: ES module (`index.js`), sem build/bundler, sem dependências de runtime (usa `fetch` nativo).
- Manifest `display_name: "Translation Layer"`, slug/pasta `st-translation-layer`, `version: 0.1.0`.

## 7. Comandos e dev loop

```
Dev (instalar para teste):
  cp -r st-translation-layer/ <clone-ST>/data/default-user/extensions/st-translation-layer/
  # ou symlink: ln -s $(pwd)/st-translation-layer <clone-ST>/data/default-user/extensions/
  # recarregar a UI do ST (F5)

Test:  checklist manual amarrado a SC-1..SC-10 (docs/PRB.md §5)
Lint:  nenhum configurado no MVP (ES module simples; opcional `npx eslint index.js lib/*.js` se crescer)
Build: nenhum (arquivos servidos como estão)
```

## 8. Estrutura do projeto

```
st-translation-layer/
  manifest.json        → metadados da extensão (gerado pelo scaffold)
  index.js             → entrypoint: wiring de eventos, handlers do pipeline
  lib/translate.js     → cliente OpenAI-compatible + prompts + retry/fallback (pura, testável)
  lib/protect.js       → extração/restauração de código/URLs/nomes (pura, testável)
  settings.html        → template da aba de settings (renderExtensionTemplateAsync)
  style.css            → estilos (chip de status, botões por mensagem)
  docs/                → PRB + SDDs (este documento)
```

## 9. Estilo de código

Convenções das extensões nativas do ST: módulo ES, `jQuery(async () => {...})` no boot, settings lidas via `loadExtensionSettings`, persistência com `saveSettingsDebounced`, handlers nomeados e idempotentes.

```js
// Padrão de handler: await-able, idempotente, sem throw para o pipeline do ST
async function onMessageSent(messageId) {
    if (!isEnabled()) return;
    const message = getContext().chat[messageId];
    if (!message || message.is_system || message.extra?.translation) return; // já traduzido
    const en = await translateService.translate(message.mes, { direction: 'toEN' });
    message.extra = message.extra ?? {};
    message.mes = en;
    message.extra.translation = { lang: settings.language, ts: Date.now() };
    // display_text = texto original digitado (já está na língua do usuário)
    message.extra.display_text = originalUserText;
    // persistência: ver SDD-2 §save
}
```

## 10. Estratégia de teste

- **MVP**: checklist manual SC-1..SC-10 executado contra ST local com (a) tradutora flash real e (b) endpoint inválido (cenários de falha). Sem framework.
- **Fase 2 (opcional)**: vitest cobrindo `lib/translate.js` (montagem de prompt, retry) e `lib/protect.js` (placeholder ida-e-volta) — módulos puros por design justamente para isto.

## 11. Boundaries

- **Always:** salvar o chat após mutar mensagens; marcar proveniência (`extra.translation`) antes de mutar; nunca quebrar o fluxo de geração do ST (handlers não podem lançar); guardar segredos (API key) apenas em `extension_settings` (já é o mecanismo do ST).
- **Ask first:** mudar schema de settings já publicada; adicionar qualquer dependência de runtime; interceptar eventos além dos listados no SDD-2.
- **Never:** mutar `mes` sem guardar a versão do usuário em `display_text` (perda irreversível); enviar conteúdo do chat para endpoints fora do Base URL configurado pelo usuário; traduzir sem toggle master ON.

## 12. Questões abertas

- Nenhuma bloqueante. Ver `Flags de implementação` no brainstorm para os pontos a verificar durante o código (caller do Generate, diálogo de edição, group chats, função de save exposta ao contexto).
