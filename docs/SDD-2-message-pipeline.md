# SDD-2 — Pipeline de mensagens (`index.js`)

v0.1 · 2026-09-01 · depende de: SDD-0, SDD-1

## 1. Mapa de eventos

| Evento (`event_types`) | Quando | Ação | FR |
|---|---|---|---|
| `MESSAGE_SENT` (awaited) | mensagem do usuário salva, antes de gerar | **Saída**: traduz `mes` user→en; guarda original em `display_text`; marca proveniência | FR-3 |
| `MESSAGE_RECEIVED` (awaited) | resposta finalizada (streaming, não-streaming, swipe) | **Entrada**: guarda `mes` EN; traduz en→user em `display_text`; marca proveniência | FR-4 |
| `MESSAGE_UPDATED` / `MESSAGE_EDITED` | edição salva / mensagem atualizada | **Re-tradução do lado alterado** (§4.3) | FR-6 |
| `IMPERSONATE_READY` | impersonate gera sugestão | (FR-12, should-have) traduz en→user no texto sugerido | FR-12 |
| `CHAT_CHANGED` | troca de chat | limpa estado runtime (Set de "view original", status) | FR-10 |
| `GENERATION_STARTED` | início de geração | liga placeholder "translating…" se toggle EN-off | FR-5 |

Observações:
- `MESSAGE_SWIPED` (10255) não é hook principal: o swipe finaliza por `finalizeIntermediateMessage` → `MESSAGE_RECEIVED` (verificado). Registrar listener nele apenas para invalidar estado runtime do messageId.
- Todos os handlers: early-return se toggle master OFF, se mensagem `is_system`, ou se já tem `extra.translation` (idempotência — SDD-0 §5.2).

## 2. Handler de saída (`MESSAGE_SENT`) — detalhe

```
onMessageSent(messageId):
  guards (enabled, !is_system, !extra.translation, chat existe)
  userText = message.mes                      // PT-BR digitado
  status: chip "translating…" na mensagem
  en = translate(userText, direction 'user→en')          // retry/falha: SDD-1 §4
  em caso de erro:
      toast com "Try again" (re-executa handler) e "Send untranslated"
      ("Send untranslated" grava userText como mes, SEM display_text, marca translation.skip=true)
  em sucesso:
      message.extra.display_text = userText   // preserva ANTES de mutar (invariante SDD-0 §5.3)
      message.mes = en
      message.extra.translation = { lang, direction: 'user→en', model, ts }
  save do chat (§5) + re-render da mensagem (mostra display_text)
```

Bloqueio do envio (implementado): como o handler é awaited antes da geração, em falha ele **abre um popup (callGenericPopup CONFIRM, botões "Retry" / "Send untranslated") e aguarda a escolha** — a geração só prossegue quando o usuário decide. "Retry" repete a tradução; "Send untranslated" marca `extra.translation = { skip: true }` e segue. Sem throw, sem rollback (atualização vs. rascunho original; verificado na fonte).

## 3. Handler de entrada (`MESSAGE_RECEIVED`) — detalhe

```
onMessageReceived(messageId, type):
  guards (enabled, !is_system, !extra.translation)
  enText = message.mes                        // EN gerado — JÁ está canônico
  se toggle "mostrar EN durante stream" OFF: manter placeholder até tradução pronta
  translated = translate(enText, direction 'en→user')     // + raciocínio se toggle FR-8
  em sucesso:
      message.extra.display_text = translated
      message.extra.translation = { lang, direction: 'en→user', model, ts }
      save + re-render
  em erro: NÃO bloqueia nada — display fica com mes EN + link "translation failed — retry"
      (link = botão por mensagem; clique reexecuta este handler forçando re-tradução)
```

- Streaming: com EN-off (default), o conteúdo EN que o ST renderiza durante o stream é substituído visualmente por overlay/placeholder CSS no bloco da mensagem até a tradução terminar (FR-5). Com EN-on, o stream aparece normal e a troca ocorre no fim.
- `type === 'impersonate'` não chega aqui (vem por `IMPERSONATE_READY`).

## 4. Re-tradução de edição (FR-6/SC-3)

### 4.1 Direção pela proveniência

| Estado da mensagem editada | Interpretação | Ação |
|---|---|---|
| tem `extra.translation` + edição veio do display (PT-BR) | usuário editou a própria língua | traduz novo display user→en → atualiza `mes` |
| tem `extra.translation` + edição veio do `mes` (EN) | usuário editou o original (modo view-original) | traduz novo mes en→user → atualiza `display_text` |
| sem `extra.translation` (mensagem antiga/não traduzida) | língua desconhecida | pergunta uma vez por chat: "qual é a língua deste texto?" → traduz para o outro lado |

### 4.2 Como saber qual lado foi editado

O diálogo de edição do ST pode carregar `mes` (EN) — flag de implementação. Estratégia: comparar pós-edição `(mes, display_text)` com os valores pré-edição capturados em `MESSAGE_EDITED` anterior; o campo que mudou é o editado. Se ambos mudarem (colar texto novo), prioriza display (§4.1 linha 1) e sincroniza o outro.

### 4.3 Regeneração

`clearMessageData` já deleta `display_text` e a pipeline limpa `extra.translation` no `MESSAGE_RECEIVED` seguinte → tradução nova automática (SC-4). Nenhum handler extra.

## 5. Persistência e render

- Após toda mutação: salvar o chat. Preferir a função de save exposta pelo contexto do ST (`saveChatConditional` equivalente); se não exposta, `getContext().saveChat()`/fallback documentado — **verificar na implementação** e registrar aqui.
- Re-render da mensagem mutada: re-render do bloco de mensagem via API do contexto (`reloadCurrentChat()` é o blunt instrument; preferir render cirúrgico do messageId se disponível).
- Anti-loop: proveniência antes de mutar + early-return em mensagens marcadas; saves nossos NÃO re-disparam tradução porque os handlers filtram por marca.

## 6. Estado runtime (não persistido)

```js
const runtime = {
  viewingOriginal: new Set<messageId>(),   // toggle "view original" (visual)
  translating: new Set<messageId>(),       // chip de status
  chatLangPrompted: new Set<chatId>(),     // §4.1 linha 3
};
// CHAT_CHANGED → limpa tudo
```

- "View original": troca apenas o DOM do bloco de texto da mensagem (guarda innerHTML dos dois estados; sem mutação em `chat`/save).
- Botões por mensagem são adicionados ao footer padrão de extras do ST (padrão de extensões); ver SDD-3 §4.

## 7. Group chats

Mesma pipeline por mensagem (os eventos carregam messageId; cada bot responde com `MESSAGE_RECEIVED` próprio). Sem decisão específica de design; coberto como caso de teste manual (flag do brainstorm).

## 8. Ordem de registro e boot

```
jQuery(async () => {
  loadExtensionSettings('translationLayer')
  migrate defaults (SDD-3 §3)
  register listeners (tabela §1)
  render settings tab (SDD-3)
})
```

`loading_order: 10` (manifest já gerado) — sem dependência de outra extensão.
