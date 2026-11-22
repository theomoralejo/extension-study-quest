# Study Quest Extension

Extensão de navegador que adiciona ao Zoho CRM: respostas rápidas nas notas, botão de
WhatsApp nos telefones, botão de copiar nos campos de valor e **histórico de alteração
de cada campo** (ícone de relógio ao lado do nome do campo, em Deal e Lead).

**Status:** roda em Chrome, Edge, Firefox e Safari (macOS).
As respostas ficam numa API própria (`cv.attriostudio.com/api`), não no storage do navegador.
Desde a 1.9.0 a extensão exige **login com o e-mail e a senha da Master Table** ([Login](#login-master-table)).

---

## Onde roda

| Navegador | Situação | Como instalar |
|---|---|---|
| Chrome | ✅ | `dist/study-quest-extension-chrome-<versão>.zip` → `chrome://extensions` → Modo desenvolvedor → Carregar sem compactação |
| Edge | ✅ | mesmo pacote do Chrome → `edge://extensions` |
| Firefox | ✅ (140+) | `dist/study-quest-extension-firefox-<versão>.zip` → `about:debugging` → Este Firefox → Carregar complemento temporário |
| Safari | ✅ (macOS 13+) | requer app nativo — ver [Safari](#safari) abaixo |

Firefox exige 140+ porque a chave `data_collection_permissions`, obrigatória para
publicar, só existe a partir dessa versão. A 1.9.0 declara `personallyIdentifyingInfo` e `authenticationInfo` (login).

Chrome Web Store (não listada): [ficha](docs/ficha-chrome-web-store.md), [permissões e dados](docs/justificativa-permissoes-chrome-web-store.md),
[política de privacidade](docs/spec-politica-privacidade-extensao.md).

---

## Login (Master Table)
<a id="login-master-table"></a>

Até a 1.8.0 a extensão mandava uma chave fixa (`x-api-key`) escrita no código. O repositório é público:
qualquer pessoa lia, editava e apagava as respostas. A 1.9.0 tira a chave e passa a exigir login por pessoa.
Contrato completo: `.scratch/login-master-table/spec.md`.

```
popup ──POST {identity,password}──▶ Master Table /api/collections/users/auth-with-password ──▶ {token PB}
popup ──POST {pbToken}───────────▶ API /api/auth/session ──(confere na Master Table)──▶ 201 {token, name, email, expiresAt}
popup/painel ──Authorization: Bearer <token>──▶ API /api/replies*, /api/categories*
```

- **`sessao.js`** é o único módulo de sessão (`globalThis.SQSessao`), carregado no popup e no content script:
  `ler()`, `gravar(s)`, `apagar()`, `api(path, {method, body})`, `entrar(email, senha)`, `sair()`, `onMudar(fn)`.
- **`sqSessao`** em `storage.local` = `{token, name, email, expiresAt}` e nada mais. A senha e o token PB vivem só
  dentro de `entrar()` e nunca são gravados. `expiresAt` no passado = sem sessão.
- **`api()`** põe o `Authorization: Bearer`. Sem sessão, rejeita sem tocar a rede. **401** apaga `sqSessao` e rejeita
  com `err.semSessao = true`: o popup volta ao card Entrar com o motivo; o painel do Zoho mostra o convite a entrar.
- **Popup sem sessão:** só o card **Entrar** (o resto some, não fica desabilitado). Com sessão: "Conectado como
  <nome>" + **Sair** (`DELETE /api/auth/session`, falha ignorada, e apaga `sqSessao`).
- **Painel no Zoho** escuta `sqSessao` (`SQBrowser.onStorageChange`): entrar ou sair no popup troca a lista do
  painel aberto sem recarregar a página.
- **Autor** da resposta: o servidor assina com a sessão. O popup não manda mais `author`, e saiu o caminho que
  lia o nome do usuário do Zoho (`getAuthor`, cache `zohoAuthor`, que o popup apaga ao abrir).
- Erros do login, cada um com causa e o que fazer: senha errada (400), verificação em duas etapas (401 com
  `mfaId`, não suportada), muitas tentativas (429), conta sem acesso (403 da API, com a mensagem da Master Table),
  sem conexão. Toda chamada do login tem tempo limite de 15 s.

**Transição no servidor:** `ACEITAR_CHAVE_ANTIGA=1` no `.env` da API aceita a `x-api-key` antiga enquanto o time
troca de versão; cada uso vai ao log. Desligar assim que o time estiver na versão da loja. Enquanto estiver ligada,
a chave antiga (que continua no histórico público do git) ainda abre a API.

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

- `test-sessao.mjs` — **Node puro, sem navegador** (`node tests/test-sessao.mjs`). Carrega o `sessao.js` real
  com storage e `fetch` falsos: Bearer em toda chamada, sem sessão nenhuma chamada sai, 401 e sessão vencida
  apagam `sqSessao`, o login grava só `{token,name,email,expiresAt}` (sem token PB, sem senha), cada erro do
  login vira a mensagem certa, e nenhum arquivo do pacote (`FILES` do build) tem `x-api-key` ou a chave antiga.
  Sabe reprovar: tirar o Bearer, gravar o objeto inteiro, não apagar no 401 ou ignorar `expiresAt` dá falha.
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
  botão Copiar (título + texto) e seletor de campos do popup; painel do Zoho
  sem sessão mostra o convite a entrar e carrega a lista sozinho quando a sessão chega.
- `e2e-extensao.mjs` — a extensão instalada de verdade num Chromium, com o
  `crm.zoho.com`, a Master Table e a API simuladas por rota: login pelo popup →
  aba do Deal → texto preenchido, sem `chrome.*` falso. Pega o que só quebra instalado.
- `test-varredura.mjs` — a varredura incremental pega campo, telefone e editor
  que chegam depois, não faz nada em aba de fundo e não regrava o storage; texto
  colado num editor (`contenteditable`) não recebe ícone nenhum.
- `bench-desempenho.mjs` — mede o JS gasto em 10 s de página viva, com e sem a
  extensão (`node tests/bench-desempenho.mjs [pasta-da-extensao]`). 1.6.0:
  ~3.900 ms; 1.7.0: ~3 ms.
- `test-deal-info.mjs` — cabeçalho do Deal no painel de notas (1.8.0): selos, grade 2×3,
  Important notes editável, linha de selos em uma linha de 760px até 288px. Doc:
  `docs/painel-notas-cabecalho-deal.md`.
- `test-notas.mjs` — painel de notas: lista, texto rico, editar/excluir,
  menções `@` (texto, link do Zoho e `crm[user#id]crm`; e-mail não vira
  menção), selo do portal do cliente, setas de encostar e cantos de tamanho.
- `test-popup.mjs` — `popup.html` sem sessão (sem `chrome`/`browser` definidos:
  a camada de compatibilidade degrada em vez de lançar; só o card Entrar, foco no
  e-mail) e com sessão, sem nada estourar a largura em 320/390/400px; login de
  ponta a ponta com `fetch` falso (Enter envia, "Entrando…", erro em `role=alert`,
  "Conectado como", resposta sem `author`, Sair, 401 volta ao login).
  `SHOTS=<pasta>` salva prints 390px; `MOTORES=chromium` roda só os motores instalados.

Os testes são úteis porque **sabem reprovar**: rodados contra a versão anterior
do código, dão 0/18 no painel (ele saía da tela em 5 das 6 posições).

---

## Estrutura

```
manifest.json      MV3, com as chaves de Firefox e Safari
browser-api.js     camada de compatibilidade entre chrome.* e browser.*
config.js          fonte única das URLs (API das respostas e Master Table)
sessao.js          login da Master Table, sessão `sqSessao` e chamadas com Bearer
field-history.js   histórico de alteração de campo (Deal e Lead)
deal-info.js       cabeçalho do Deal no painel de notas (selos, grade, Important notes)
drag.js            painéis arrastáveis pelo cabeçalho, posição lembrada no storage
placeholders.js    #Campo nas respostas: troca pelo valor do registro aberto
content.js         injeta painel, WhatsApp, copiar; e é o dono do observer e do despachante
popup.html/css/js  login, gestão das respostas rápidas + diagnóstico do histórico
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

`alive()` responde `false` quando a extensão foi atualizada ou recarregada com a
aba aberta: o Chrome não reinjeta o script novo e o antigo perde a API (toda
chamada lança "Extension context invalidated"). O `content.js` checa isso a cada
varredura e se aposenta (`retire()`): desliga o observer e os listeners, tira os
botões da tela e mostra um aviso pedindo F5. Prova: bloco 4 de `tests/e2e-extensao.mjs`.

---

## Backend

`backend-api/` roda separado da extensão. Configuração por variável de
ambiente — copie `backend-api/.env.example` para `.env` e preencha.
A lista exata (banco, Master Table, sessões em `extension_sessions`) fica no `backend-api/.env.example`,
reescrito junto com o login. `ACEITAR_CHAVE_ANTIGA=1` liga a transição descrita em [Login](#login-master-table).

A API falha alto no boot se faltar um obrigatório. Isso é intencional: um
fallback embutido no código significaria credencial conhecida em produção.

### Sem chave no cliente

Tudo que a extensão carrega é legível por quem a instala ou desempacota o `.zip`; por isso o cliente não leva
segredo nenhum. O acesso é por pessoa, conferido no servidor (sessão da Master Table + feature flag
`study_quest_extension`). O `tests/test-sessao.mjs` reprova se `x-api-key` ou a chave antiga voltar a um arquivo do pacote.

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
