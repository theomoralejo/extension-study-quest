# Study Quest Extension

Extensão de navegador que adiciona respostas rápidas às notas do Zoho CRM, botão de
WhatsApp nos telefones e botão de copiar nos campos de valor.

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

- `test-painel.mjs` — injeta o painel num DOM que imita o Zoho e verifica, em
  6 posições de tela (quatro cantos, janela estreita, janela baixa), que o
  painel **fica dentro da viewport** e que nenhum card estoura a largura.
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
content.js         injeta painel, botão de WhatsApp e botão de copiar no CRM
popup.html/css/js  gestão das respostas rápidas
styles.css         estilos do que é injetado na página do CRM
backend-api/       API Node/Express + MySQL (NÃO vai no pacote da extensão)
scripts/build.sh   empacotamento por navegador
tests/             testes cross-browser
```

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
