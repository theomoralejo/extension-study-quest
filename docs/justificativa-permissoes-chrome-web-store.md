# Justificativa de permissões e dados — Chrome Web Store (1.9.0)

**Preparada em 22/nov/2026. Nada submetido.** Fonte: `manifest.json` da 1.9.0 e o uso real no código.
Campo do painel: aba **Privacy** (um texto por permissão; o inglês é o que se cola).

## Propósito único (campo "Single purpose")

PT: Dar à equipe da Study Quest, dentro do Zoho CRM da empresa, respostas rápidas e ferramentas de trabalho com registros (painel de notas, WhatsApp, copiar campo, histórico de campo), com login da Master Table.

EN: Help Study Quest staff work in the company's Zoho CRM: insert the team's quick replies into notes and work with CRM records (notes panel, WhatsApp link, copy field, field change history), after signing in with their Study Quest Master Table account.

## Permissões

| Permissão | Texto para colar (EN) | Onde no código |
|---|---|---|
| `storage` | Keeps the user's session for the quick-replies server (token, name, email, expiry), the panel positions the user chose, the list of field names of the last opened record, and field change history read from the record's timeline. Nothing is synced to other devices. | `sessao.js`, `drag.js`, `popup.js`, `notes-panel.js`, `field-history.js` |
| `activeTab` | When the user opens the toolbar popup, it reads the active tab to know whether it is a Zoho CRM record and asks that tab to fill the reply's `#Field` placeholders with the record's values. | `popup.js` |
| `clipboardWrite` | The "Copiar" buttons copy a quick reply (popup) or a field value (Zoho page) when the user clicks them. | `popup.js`, `content.js` |

## Hosts

| Host | Texto para colar (EN) | Onde no código |
|---|---|---|
| `https://*.zoho.com/*`, `*.zoho.eu`, `*.zoho.uk`, `*.zoho.in`, `*.zoho.com.au`, `*.zoho.jp`, `*.zohocloud.ca`, `*.zoho.sa` | The content script runs only on Zoho CRM pages (`/crm/*`) of the data centers Zoho offers. It adds the quick-replies button to the note editor, the notes side panel, WhatsApp and copy buttons, and the field history icon. It reads the open record through the user's own Zoho session in that tab; that data stays between the browser and Zoho. | `content.js`, `notes-panel.js`, `field-history.js`, `deal-info.js`, `placeholders.js`, `zoho-api.js` |
| `https://cv.attriostudio.com/*` | Study Quest quick-replies server (operated by Attrio Studio): exchanges the Master Table sign-in for an extension session, and lists, creates, edits and deletes the team's quick replies. | `sessao.js`, `popup.js`, `content.js` |
| `https://api.master.studyquestuk.com/*` | Study Quest Master Table: sign-in with the user's email and password, only from the popup and only when the user clicks "Entrar". | `sessao.js` |

Código remoto: **No, I am not using remote code.** Todo o JavaScript vai no pacote; sem `eval`, sem script baixado.

## Tipos de dados (marcar no painel)

| Caixa | Marcar | Por quê |
|---|---|---|
| Personally identifiable information | **Sim** | Nome e e-mail da pessoa logada (sessão) e o nome do autor de cada resposta rápida. No Zoho, a extensão mostra dados de alunos (nome, telefone) que já estão na tela, sem enviá-los a servidor nosso. |
| Authentication information | **Sim** | E-mail e senha da Master Table, enviados só à Master Table no login; o token da sessão da extensão fica no navegador. A senha não é guardada. |
| Website content | **Sim** | Lê o conteúdo das páginas do Zoho CRM (campos do registro, notas, linha do tempo) para preencher `#Campo`, mostrar o painel de notas e o histórico de campo. |
| Health, Financial and payment, Personal communications, Location, Web history, User activity | Não | A extensão não coleta. Os textos das notas do Zoho são lidos e gravados no próprio Zoho, não num servidor nosso. |

As três declarações seguintes (não vender dados, não usar para fim alheio ao propósito único, não usar para crédito) são verdadeiras e estão na [política](spec-politica-privacidade-extensao.md).

## Pontos que o revisor costuma questionar

| Ponto | Resposta pronta |
|---|---|
| Oito domínios do Zoho | O Zoho CRM tem um domínio por data center; a Study Quest usa `.com` e `.eu`, e os outros cobrem a mesma ferramenta em qualquer região. O content script só roda em `/crm/*`. |
| Login com senha numa extensão | A senha vai direto para a Master Table da Study Quest (o mesmo login do app da empresa), em HTTPS, e não é guardada. O servidor das respostas recebe só o token temporário da Master Table e devolve um token próprio, que só abre as respostas rápidas. |
| Conta para teste | Conta de revisão da Master Table, informada na aba **Test instructions** ([ficha](ficha-chrome-web-store.md#aba-test-instructions-instruções-de-teste)). |
