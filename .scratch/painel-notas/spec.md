CRM: pendente de espelho (sem credencial do CRM da Attrio no Mac em 2026-11-06)

# Painel lateral de notas (pedido do Mauro, 06/11/2026)

**Status:** entregue na versão 1.3.0 (PR #1, commit d33b3ef). Falta validar no Zoho real da Study Quest.

Aba "Notas" na borda direita de toda página de registro do Zoho CRM abre um painel fixo
com todas as notas (mais nova no topo) e um campo que grava nota nova no registro.

## Aceite pendente
- Mauro abre um Deal, clica em "Notas", vê as notas e grava uma nota que aparece também na lista nativa do Zoho.
- Conferir em Lead, Contact e um módulo custom.

## 1.6.0 (2026-11-06)

- Editar (PUT /Notes/{id}) e excluir (DELETE /Notes/{id}, com confirmação) no painel; só aparece quando `$editable` não é false.
- "Compartilhar com o cliente" = `$is_shared_to_client` (Share to customer do Zoho).
- Texto rico: barra igual à do Zoho; HTML passa por lista branca ao mostrar, colar e salvar. Sem formatação, sai texto puro como antes.
- Lista nativa do Zoho não sabe da gravação pela API: aviso com "Recarregar página".
