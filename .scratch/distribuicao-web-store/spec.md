CRM: pendente de espelho (sem credencial do CRM da Attrio no Mac em 2026-11-06; criar tarefa-mãe na próxima sessão com acesso)

# Distribuição pela Chrome Web Store (atualização automática)

**Status:** backlog — aprovado para organizar, **não iniciar agora** (Theo, 2026-11-06).

## Problema

Hoje a extensão é instalada por "Carregar sem compactação". Extensão desempacotada nunca
se atualiza: cada versão nova exige baixar o zip e recarregar em `chrome://extensions`
em cada máquina do time da Study Quest.

## Por que não pelo GitHub

Doc oficial do Chrome: no Windows e no macOS, o `update_url` precisa apontar para a
Chrome Web Store; auto-hospedagem só no Linux.
https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions

## Decisão

Publicar como **Não listada** (Unlisted) na conta de desenvolvedor da Attrio.
Instala só quem tem o link; atualiza sozinha. Edge instala pelo mesmo link.
https://developer.chrome.com/docs/webstore/cws-dashboard-distribution

## Aceite

- Extensão instalável pelo link da loja em Chrome e Edge.
- Nova versão publicada chega às máquinas sem ação do usuário.
- Time da Study Quest migrado da versão desempacotada para a da loja (desinstalar a antiga).
- README atualizado com o link de instalação e o fluxo de publicar versão.

## Fora de escopo agora

- Firefox (assinatura no AMO) e Safari (app nativo) — continuam manuais.
