# medicao/ — hipoteses medidas e DESCARTADAS sobre o travamento ao inserir nota

Isto nao e teste e nao entra no `npm test`. E o registro de duas hipoteses que
pareciam certas, foram medidas e **nao se sustentaram**. Fica versionado para
ninguem gastar o mesmo dia investigando de novo.

O contexto: em 25/set/2026 a extensao travava e derrubava a aba ao selecionar uma
resposta para inserir na nota. O `field-history.js` era o suspeito obvio — tinha
entrado no commit anterior (`2ad0ff1`) e varre a pagina inteira, shadow DOM
incluso, a cada lote de mutacao.

## Como rodar

```bash
node tests/medicao/servidor.mjs 8731
# custo por tick em funcao do tamanho da pagina:
#   http://localhost:8731/crm/org1/tab/Deals/1234567
# idempotencia + sustentacao do laco:
#   http://localhost:8731/crm/org1/tab/Deals/1234567?p=laco
```

O caminho `/tab/Deals/<id>` e obrigatorio: o `onUrl()` do `field-history.js` so
ativa o modulo quando o `location.pathname` casa esse padrao, e em `file://` nao
da para falsificar o pathname. Tudo sob `/crm/v*` responde **403 de proposito**,
para a API "recusar" e o modulo cair na raspagem da Timeline — o caminho caro.

## Hipotese 1 — "o tick e quadratico e por isso trava" → FALSA

`scrapeTimeline()` chama `el2.textContent` para todo elemento da pagina, e
`textContent` custa o tamanho da subarvore. No papel isso e quadratico.

Medido (`medir-tick.html`, Chromium, 60 entradas de Timeline):

| elementos | pior tick quente |
|---|---|
| 1014 | 42 ms |
| 2014 | 61 ms |
| 4014 | 35 ms |
| 8014 | 79 ms |

Dobrar os elementos nao dobra o tempo — o crescimento e aproximadamente linear e
o custo absoluto fica na casa das dezenas de ms. **Nao trava aba nenhuma.**

## Hipotese 2 — "addIcons muta o DOM, o observer reage, e o laco nao para" → FALSA

`addIcons()` faz `node.prepend(btn)`, que e mutacao de `childList`; o observer do
`content.js` observa exatamente isso. Se cada tick inserisse um icone novo, cada
tick agendaria o proximo para sempre.

Medido (`medir-laco.html`):

- **Idempotencia**, DOM parado, 6 ticks seguidos: `0, 0, 0, 0, 0, 0` icones novos.
  O primeiro tick coloca 20 e os seguintes nao colocam nada — `data-zfh` segura.
- **Sustentacao**, observer real ligado + UMA insercao no `contenteditable`:
  **1 tick** em 8 s de observacao, 10 ms no total. Assenta.

## Onde o defeito realmente estava

Em `content.js`, na decisao de qual no recebe o texto — nao no `field-history.js`.
O portao que prova isso e `tests/test-insercao.mjs`, que roda no `npm test`.
