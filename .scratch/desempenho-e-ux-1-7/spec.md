CRM: pendente de espelho (sem credencial do CRM da Attrio — client.attriostudio.com — no Mac em 2026-11-10)

# Desempenho + arrastar + #Campo + Copiar (pedido do Mauro, 10/11/2026)

**Status:** entregue na versão 1.7.0.

| # | Item | Prazo | Estado |
|---|---|---|---|
| 01 | Desempenho: extensão leve para todos, usando ou não | 20/11 | feito — bench 3.900 ms → 3 ms de JS por 10 s |
| 02 | Painéis arrastáveis; fluxo mantido ao recolher | 17/11 | feito |
| 03 | `#Campo` do registro no "Texto da Resposta" | 17/11 | feito |
| 04 | Botão Copiar ao lado de Editar/Excluir em "Minhas Respostas" | 13/11 | feito |

## Interpretações registradas
- "arrastável": painel de notas e painel de respostas rápidas movem pelo cabeçalho e lembram a posição; duplo clique volta ao padrão. O popup do navegador não pode ser arrastado (limite do Chrome).
- "manter o flow ao recolher": painel aberto continua aberto após trocar de página/recarregar; rascunho, posição e rolagem da lista voltam; a aba Notas acompanha o painel e, recolhida, arrasta na vertical.
- "# valores relativos aos deals": `#Nome_API` (ex.: `#Deal_Name`, `#Stage`, `#Owner`) vira o valor do registro aberto ao inserir. Hashtag que não é campo fica como está.

## Aceite pendente
- Mauro e equipe confirmam que o PC não pesa mais com o Zoho aberto.
- Testar `#Deal_Name` num Deal real.

## Testes
`node tests/test-recursos.mjs` (38 casos, provados reprovando com defeito injetado) · `node tests/test-varredura.mjs` · `node tests/bench-desempenho.mjs`
