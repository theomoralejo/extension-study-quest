# Painel de Notas: cabeçalho do Deal (1.8.0)

Pedido do Mauro, tarefa 6946750000083198022 do Zoho CRM da Study Quest
("StudyQuest Extension update - new deal info header in the Notas panel").

## O que aparece (só em registro de Deal)

1. **Linha do título, sempre em uma linha:** `X notas | DSA | Speaking | Qnt. Deals | All Conditions Met + dias`.
   - DSA: `DSA Yes` vermelho `#f00a30`, `DSA No` verde `#67c480` (cores do picklist). Vazio: some.
   - Speaking (`Speaking`): roxo, ícone de microfone. Vazio: some.
   - Qnt. Deals: Deals com o mesmo contato (`Contact_Name`), por COQL. Se a COQL for recusada, usa `Number_of_applications`.
   - All Conditions Met (`All_Conditions_Met`) + selo branco com `Number_7` (Days of Unco.), ex.: `Requested 0d`.
2. **Grade 2×3:** Deal owner (`Owner`), Submitted by (`Submitted_by`), Stage (`Stage` + dias de `Formula_19`),
   Student rep (`Sales_person1`), Student consultant (`Student_Consultant`), Assessment tracker
   (`Contact_Pipeline` + dias de `Days_on_This_stage`). Vazio = `-`. Texto longo corta com `…`; o valor inteiro fica no tooltip e o selo de dias continua visível.
   Selo de dias: verde abaixo de 7, âmbar de 7 a 14, vermelho acima de 14.
3. **Important notes** (`Important_Notes1`): caixa amarela entre a grade e as notas.
   - Com texto: aberta por padrão. `hide`/`show` ou clique na barra do título fecha/abre; a escolha fica salva no navegador (`localStorage`, chave `sqn-important-open`).
   - `Edit` vira caixa de texto com `Cancel`/`Save`. `Save` grava no Deal (`PUT /Deals/{id}`) e lê o Deal de novo; `Cancel` volta ao texto anterior. Ctrl/⌘+Enter salva, Esc cancela.
   - Sem texto: só o link `+ Add important note`, que abre o mesmo editor.

## Largura do painel

A linha nunca quebra. Ela encolhe nesta ordem:

| Largura do painel | O que muda |
|---|---|
| > 640px | tudo como no mock-up |
| ≤ 640px | Speaking e Qnt. Deals viram ícone + número (texto no tooltip) |
| ≤ 520px (inclui a padrão, 448px) | o título "Notas" sai; o contador "X notas" fica |
| ≤ 420px | sai o ícone de "certo" do All Conditions Met |
| ≤ 340px | `DSA No` vira `No` na cor do DSA; o valor do All Conditions Met pode cortar com `…` |
| ≤ 300px (mínimo 288px) | Speaking e Qnt. Deals ficam só o número, na cor de cada um |

Painel solto (duas setas no cabeçalho) começa o mesmo corte um pouco antes.

## Como lê o Zoho

`deal-info.js`, pela sessão já aberta na aba (`SQZoho`: cookie CSRF + `X-CRM-ORG`), sem OAuth:

- `GET /crm/v8/Deals/{id}?fields=Owner,Submitted_by,Stage,Formula_19,Sales_person1,Student_Consultant,Contact_Pipeline,Days_on_This_stage,DSA,Speaking,All_Conditions_Met,Number_7,Important_Notes1,Contact_Name,Number_of_applications`
- `POST /crm/v8/coql` `select COUNT(id) from Deals where Contact_Name = '<id numérico>'`
- `PUT /crm/v8/Deals/{id}` `{"data":[{"Important_Notes1": "..."}]}`. Roda os workflows do Zoho como uma edição feita na tela.

Recarrega no botão ↻ do painel e ao trocar de registro (setas do Zoho ou outro link). Falha ou falta de permissão mostra uma linha
"Deal info unavailable (...)" no lugar da grade; a lista de notas, o editor e os botões continuam funcionando.
O histórico de campo (`field-history.js`) não põe o ícone de relógio dentro do painel de Notas.

## Testes

- `node tests/test-deal-info.mjs` (Zoho simulado): valores do deal de exemplo, uma linha de 760px a 288px (encostado e solto),
  campos vazios, stage longo, cores dos dias, abrir/fechar lembrado, editar/salvar/cancelar, erro ao salvar, Deal recusado,
  COQL recusada, Lead, troca de deal e ↻. `SQ_SHOTS=/pasta` grava os prints.
- No Zoho real (Chromium headless com o pacote `dist/extension`), 21/11/2026: deal da Sonia (somente leitura) e gravação num deal de teste criado e apagado.
