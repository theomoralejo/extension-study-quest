CRM: pendente de espelho (Cofre sem token neste Mac em 2026-11-11; criar tarefa LOCAL no CRM da Attrio — client.attriostudio.com — na próxima sessão com acesso)

# Feedback do Mauro — extensão 1.7.5

Status: entregue (commit 4413f5b, versão 1.7.5)

| Item | Estado |
|---|---|
| Quick reply assinado com o usuário errado ("Ricarth") | feito: autor por `/users?type=CurrentUser`; editar mantém o autor |
| Tela travando ao colar nota grande (Windows) | feito: varredura pula `contenteditable` |
| Copiar sem o título | feito: título + linha em branco + texto |
| @menção em negrito azul, sem link | feito (formato da API não documentado: cobre link `@Nome`, `crm[user#id]crm` e `@Nome` de usuário do Zoho) |
| Nota de portal do cliente "deixar mostrando" | feito na interpretação: selo "Visível no portal do cliente" no cabeçalho do cartão, sempre visível; aguardando confirmação do Theo |
| Painel de notas redimensionável na diagonal | feito: cantos de baixo, tamanho salvo |
| Setas para encostar à esquerda/direita | feito: no cabeçalho; direita → ←, esquerda → →, solto → as duas |

## Comments
- Respostas já salvas com autor errado não mudam sozinhas.
- Painel de respostas rápidas ficou sem redimensionar (pedido era do painel de notas).
