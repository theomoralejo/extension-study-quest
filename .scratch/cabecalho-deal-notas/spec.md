CRM: Zoho CRM da Study Quest, tarefa 6946750000083198022 (pedido do Mauro, prazo 27/11/2026)

# Cabeçalho do Deal no painel de Notas (1.8.0)

Status: implementado na branch `feat/notas-deal-header`; aguardando merge (portão de CI) e distribuição.
Doc: `docs/painel-notas-cabecalho-deal.md`.

## Decisões
- Na largura padrão (448px) o título "Notas" sai da linha para `Requested 0d` caber inteiro; o contador "X notas" fica.
- `Number_of_applications` só entra se a COQL for recusada (a spec pede COQL; o campo é o plano B).
- Aberto/fechado do Important notes é uma preferência do navegador (não por deal).
- PUT do Important notes roda workflows (mesma coisa que editar na tela do Zoho).
- `field-history.js` passou a ignorar `.sqn-panel`/`.sqn-tab`: punha o relógio dentro do selo "DSA".
