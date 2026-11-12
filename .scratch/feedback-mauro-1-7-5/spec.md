CRM: pendente de espelho (Cofre sem token neste Mac em 2026-11-11; criar tarefa LOCAL no CRM da Attrio — client.attriostudio.com — na próxima sessão com acesso)

# Feedback do Mauro — extensão 1.7.5

Status: encerrado (Theo testou e aprovou em 12/nov/2026; versão final 1.7.6). Selo "Veio do portal" dispensado pelo Theo.

| Item | Estado |
|---|---|
| Quick reply assinado com o usuário errado ("Ricarth") | feito: autor por `/users?type=CurrentUser`; editar mantém o autor |
| Tela travando ao colar nota grande (Windows) | feito: varredura pula `contenteditable` |
| Copiar sem o título | feito: título + linha em branco + texto |
| @menção em negrito azul, sem link | feito (formato da API não documentado: cobre link `@Nome`, `crm[user#id]crm` e `@Nome` de usuário do Zoho) |
| Nota de portal do cliente "deixar mostrando" | REABERTO (Theo, 12/nov/2026): nota de portal = nota escrita pelo cliente no portal do Zoho; o cartão deve mostrar que veio de lá. O selo atual (`$is_shared_to_client`, "Visível no portal do cliente") marca outra coisa: nota da equipe compartilhada com o cliente; Theo decidiu MANTER (12/nov/2026). Bloqueado: a doc da API v8 de Notes não tem campo que marque nota criada no portal; falta ler uma nota real (Theo loga no Zoho no navegador do Traycer ou manda link de um Deal com nota do portal) |
| Painel de notas redimensionável na diagonal | feito: cantos de baixo, tamanho salvo |
| Setas para encostar à esquerda/direita | feito: no cabeçalho; direita → ←, esquerda → →, solto → as duas |

## Comments
- Respostas já salvas com autor errado não mudam sozinhas.
- Painel de respostas rápidas ficou sem redimensionar (pedido era do painel de notas).
