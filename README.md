# Study Quest Extension

Extensão de navegador que adiciona ao Zoho CRM: respostas rápidas nas notas, botão de
WhatsApp nos telefones, botão de copiar nos campos de valor e **histórico de alteração
de cada campo** (ícone de relógio ao lado do nome do campo, em Deal e Lead).

**Status:** roda em Chrome, Edge, Firefox e Safari (macOS).
As respostas ficam numa API própria (`cv.studyquestuk.com/api`), não no storage do navegador.

---

## Onde roda

| Navegador | Situação | Como instalar |
|---|---|---|
| Chrome | ✅ | `dist/study-quest-extension-chrome-<versão>.zip` → `chrome://extensions` → Modo desenvolvedor → Carregar sem compactação |
| Edge | ✅ | mesmo pacote do Chrome → `edge://extensions` |
| Firefox | ✅ (140+) | `dist/study-quest-extension-firefox-<versão>.zip` → `about:debugging` → Este Firefox → Carregar complemento temporário |
| Safari | ✅ (macOS 13+) | requer app nativo — ver [Safari](#safari) abaixo |

Firefox exige 140+ porque a chave `data_collection_permissions`, obrigatória para
publicar, só existe a partir dessa versão.

---

## Build

```bash
./scripts/build.sh            # dist/ + zips de Chrome/Edge e Firefox + lint
./scripts/build.sh --safari   # o acima + projeto Xcode e app do Safari
```

O script empacota a partir de uma **lista explícita de arquivos**, não da pasta
inteira. Isso é de propósito: empacotar o diretório levava junto `backend-api/`
— o código do servidor — para dentro do pacote que o usuário instala. Arquivo
novo só entra no pacote depois de ser declarado em `FILES`/`DIRS` no script.

---

## Testes

Rodam a extensão nos três motores de verdade (Gecko/Firefox, WebKit/Safari,
Chromium/Chrome+Edge) via Playwright.

```bash
cd tests
npm run setup   # instala playwright + os três navegadores (uma vez)
npm test
```

- `test-unificacao.mjs` — **roda em Node puro, sem navegador e sem `setup`**
  (`node tests/test-unificacao.mjs`). Prova que histórico de campo e quick
  replies convivem num content script só: um único listener de mensagem, o
  despachante respondendo as duas features e ignorando o resto, a ordem de
  carga do manifest, e zero colisão de classe CSS. Sabe reprovar: com um
  segundo `onMessage` injetado no `content.js`, falha com "encontrados 2".

- `test-painel.mjs` — injeta o painel num DOM que imita o Zoho e verifica, em
  6 posições de tela (quatro cantos, janela estreita, janela baixa), que o
  painel **fica dentro da viewport** e que nenhum card estoura a largura.
- `test-insercao.mjs` — clica numa resposta e confere **onde o texto foi
  escrito**. Roda as duas formas do editor de nota: a *plana*, em que o próprio
  `.lyteEditorMainDiv` é `contenteditable="true"` (a que o `harness.html` já
  modelava), e a de *invólucro*, em que ele é `contenteditable="false"` e quem
  aceita texto é um filho — que é a forma do Zoho real e a que ninguém testava.
  Exige que o texto chegue inteiro ao nó que edita e que **nada** seja escrito em
  nó não editável. Sabe reprovar: com o `getAttribute('contenteditable')` de
  volta, a forma de invólucro dá 4 falhas (o texto vai para o invólucro e o campo
  fica vazio) — e a forma plana continua passando, que é exatamente por que o
  defeito sobrevivia à suíte.
- `test-recursos.mjs` — recursos da 1.7.0: `#Campo` trocado pelo valor do
  registro (e hashtag comum preservada), painéis arrastáveis com posição
  lembrada após recarregar, painel de notas que continua aberto com o rascunho,
  botão Copiar e seletor de campos do popup.
- `test-varredura.mjs` — a varredura incremental pega campo, telefone e editor
  que chegam depois, não faz nada em aba de fundo e não regrava o storage.
- `bench-desempenho.mjs` — mede o JS gasto em 10 s de página viva, com e sem a
  extensão (`node tests/bench-desempenho.mjs [pasta-da-extensao]`). 1.6.0:
  ~3.900 ms; 1.7.0: ~3 ms.
- `test-popup.mjs` — carrega `popup.html` **sem `chrome`/`browser` definidos**,
  provando que a camada de compatibilidade degrada em vez de lançar, e checa
  que nada estoura a largura em 320/390/400px.

Os testes são úteis porque **sabem reprovar**: rodados contra a versão anterior
do código, dão 0/18 no painel (ele saía da tela em 5 das 6 posições).

---

## Estrutura

```
manifest.json      MV3, com as chaves de Firefox e Safari
browser-api.js     camada de compatibilidade entre chrome.* e browser.*
config.js          fonte única da URL da API e dos headers
field-history.js   histórico de alteração de campo (Deal e Lead)
drag.js            painéis arrastáveis pelo cabeçalho, posição lembrada no storage
placeholders.js    #Campo nas respostas: troca pelo valor do registro aberto
content.js         injeta painel, WhatsApp, copiar; e é o dono do observer e do despachante
popup.html/css/js  gestão das respostas rápidas + diagnóstico do histórico
styles.css         estilos do que é injetado na página do CRM
field-history.css  estilos do histórico (prefixo .zfh-*)
backend-api/       API Node/Express + MySQL (NÃO vai no pacote da extensão)
scripts/build.sh   empacotamento por navegador
tests/             testes cross-browser + teste de unificação
```

### Histórico de campo (`field-history.js`)

Veio da extensão separada **Zoho CRM Field History 3.4.0**, do Mauro, e foi
incorporada aqui em vez de conviver como um segundo add-on. Três adaptações
foram obrigatórias — nenhuma é cosmética, e cada uma corresponde a uma falha
**silenciosa** se for desfeita:

| O que mudou | Se voltar ao original |
|---|---|
| `chrome.storage.*` → `SQBrowser` | funciona em Chrome/Edge e morre em Firefox e Safari, que esta extensão suporta |
| MutationObserver próprio removido; quem chama é o observer único do `content.js` | dois observers varrendo `document.body` inteiro em paralelo, na página mais pesada do CRM |
| `chrome.runtime.onMessage` próprio removido; há **um** despachante no `content.js` | em MV3 vence o primeiro listener que chama `sendResponse` — o nosso responde `undefined` a mensagem desconhecida e engoliria a resposta do outro |

A leitura usa a **sessão do Zoho já aberta na aba** (cookie CSRF + endpoint
interno `/crm/v8/...`, não a API pública com OAuth). É o que faz a feature
funcionar sem credencial nenhuma — e também o que a torna sensível a mudança
do Zoho: se a chamada passar a ser recusada, o módulo cai sozinho para ler a
aba Timeline na tela. O popup diz em qual dos dois caminhos ele está.

Regra para a próxima feature: **não registre um segundo `onMessage`.** Entra
como mais um `if` no despachante do `content.js`, e o `test-unificacao.mjs`
reprova se alguém esquecer.

### `browser-api.js`

Chrome e Edge expõem `chrome.*` com callbacks; Firefox e Safari expõem
`browser.*` com Promises. Em vez de apostar em qual modelo o navegador usa,
cada wrapper chama a API e decide **pelo valor de retorno**: se veio um
thenable, é Promise; se veio `undefined`, o resultado chega pelo callback.
Todos os métodos retornam Promise e resolvem um fallback em vez de rejeitar,
para que a página continue funcionando fora do contexto da extensão.

---

## Backend

`backend-api/` roda separado da extensão. Configuração por variável de
ambiente — copie `backend-api/.env.example` para `.env` e preencha:

```
DB_USER, DB_PASSWORD, API_KEY   # obrigatórios: a API não sobe sem eles
DB_HOST, DB_NAME, PORT, ALLOWED_ORIGINS
```

A API falha alto no boot se faltar um obrigatório. Isso é intencional: um
fallback embutido no código significaria credencial conhecida em produção.

### A chave da API não é um segredo

Tudo que a extensão carrega é legível por qualquer pessoa que a instale ou
desempacote o `.zip`. A `API_KEY` serve só para barrar tráfego anônimo casual
— não é controle de acesso, e não deve ser reaproveitada em outro sistema.
Autenticação de verdade precisa ser por usuário, validada no servidor.

---

## Safari

Safari não carrega uma extensão web direto: ela precisa ser embrulhada num app
nativo (`xcrun safari-web-extension-converter`, que `scripts/build.sh --safari`
executa). O build local usa assinatura ad-hoc e serve para testar:

1. `./scripts/build.sh --safari`
2. Abrir `dist/safari/Study Quest Extension.app` uma vez
3. Safari → Ajustes → Avançado → "Mostrar funcionalidades para desenvolvedores web"
4. Safari → Desenvolvedor → "Permitir Extensões Não Assinadas"
5. Safari → Ajustes → Extensões → habilitar

**Para distribuir** (instalar na máquina de outra pessoa sem modo
desenvolvedor) é preciso assinar com uma conta Apple Developer paga e
distribuir pela App Store ou por Developer ID.
