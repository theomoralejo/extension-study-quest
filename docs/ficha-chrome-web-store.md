# Ficha da Study Quest Extension na Chrome Web Store

**Preparada em 22/nov/2026 para a versão 1.9.0. Nada submetido.** Quem envia: o Theo, com a conta de
desenvolvedor da Attrio (editor **Attrio Studio**). Permissões: [justificativa](justificativa-permissoes-chrome-web-store.md).
Privacidade: [texto da política](spec-politica-privacidade-extensao.md), publicada em https://attriostudio.com/privacidade-extensao-study-quest/ (página 3068 do WordPress da Attrio, 22/nov/2026).

## O arquivo

| O quê | Onde |
|---|---|
| Pacote | `dist/study-quest-extension-chrome-1.9.0.zip`, gerado por `./scripts/build.sh` |
| Conteúdo | Só os arquivos da lista `FILES` do `scripts/build.sh` + `icons/`. Sem `backend-api/`, sem testes, sem chave de API |
| Manifesto | Sem o campo `key` (a loja recusa o pacote com ele) |

**Não abra o ZIP.** Envie o arquivo fechado.

## Aba "Store listing" (Ficha da loja)

| Campo | Valor |
|---|---|
| Nome | Study Quest Extension (vem do `manifest.json`) |
| Resumo (até 132 caracteres) | Vem do `manifest.json`, em pt-BR: "Respostas rápidas, painel de notas, WhatsApp, copiar campo e histórico de campo no Zoho CRM da Study Quest. Login da Master Table." (130 caracteres) |
| Categoria | Ferramentas de trabalho (Workflow & Planning) |
| Idioma | Português (Brasil) |
| Ícone | `icons/icon128.png` |
| Site / suporte | https://attriostudio.com · info@attriostudio.com |
| Política de privacidade | https://attriostudio.com/privacidade-extensao-study-quest/ |

### Resumo em inglês (referência; a loja usa o do manifesto)

> Quick replies, notes panel, WhatsApp, copy field and field history in the Study Quest Zoho CRM. Sign in with Master Table.

### Descrição detalhada (pt-BR, para colar)

> Ferramenta interna da equipe da Study Quest para trabalhar no Zoho CRM.
>
> Respostas rápidas: insira nas notas do Zoho respostas prontas da equipe, já com os dados do registro aberto (`#Campo` vira o valor do Deal).
> Painel de notas: leia, escreva e edite as notas do registro num painel lateral, com o cabeçalho do Deal.
> WhatsApp: botão ao lado de cada telefone abre a conversa.
> Copiar campo: botão para copiar o valor de um campo com um clique.
> Histórico de campo: ícone de relógio ao lado de cada campo mostra quem mudou, quando e de qual valor para qual.
>
> A extensão exige login com o e-mail e a senha da Master Table da Study Quest, e só funciona para contas com acesso liberado pelo TI. Instalar a extensão não dá acesso ao Zoho CRM nem a dados de outras contas.

### Descrição detalhada (inglês, se o painel pedir)

> Internal tool for the Study Quest team working in Zoho CRM.
>
> Quick replies: insert the team's ready-made replies into Zoho notes, already filled with the open record's data (`#Field` becomes the Deal's value).
> Notes panel: read, write and edit the record's notes in a side panel, with the Deal header.
> WhatsApp: a button next to each phone number opens the chat.
> Copy field: copy a field's value with one click.
> Field history: a clock icon next to each field shows who changed it, when, and from which value to which.
>
> Sign-in with the Study Quest Master Table email and password is required, and only accounts enabled by IT can use it. Installing the extension gives no access to Zoho CRM or to other accounts' data.

## Aba "Distribution" (Distribuição)

| Campo | Valor |
|---|---|
| Visibilidade | **Não listada (Unlisted)**: instala só quem tem o link; atualiza sozinha (decisão em `.scratch/distribuicao-web-store/spec.md`) |
| Países | Todos (a equipe trabalha do Brasil e do Reino Unido) |
| Preço | Gratuita |

## Aba "Privacy" (Privacidade)

Propósito único, justificativa de cada permissão e tipos de dados: [justificativa-permissoes-chrome-web-store.md](justificativa-permissoes-chrome-web-store.md).

## Capturas de tela (a produzir, 1280 × 800 px)

Com dados **fictícios** (Deal, pessoas e telefones inventados), no Chromium, popup e Zoho de teste. Nenhum dado real de aluno.

| # | Conteúdo |
|---|---|
| 1 | Popup sem sessão: card **Entrar** ("Use o e-mail e a senha da Master Table") |
| 2 | Popup com sessão: "Conectado como …", formulário Nova Resposta e a lista Minhas Respostas |
| 3 | Zoho, editor de nota aberto, painel de respostas rápidas com a lista preenchida pelos dados do Deal |
| 4 | Zoho, painel lateral de Notas com o cabeçalho do Deal (selos e grade) |
| 5 | Zoho, ícone de relógio aberto mostrando o histórico de um campo |

Tile pequeno (440 × 280 px): logo da Study Quest sobre fundo azul `#0067A6` chapado (sem degradê). Vídeo: não enviar.

## Aba "Test instructions" (Instruções de teste)

A extensão não funciona sem login. Antes do envio, o TI da Study Quest cria na Master Table uma conta de revisão
(papel com a feature flag `study_quest_extension` ligada, sem verificação em duas etapas, sem acesso a outras telas)
e guarda a senha no Cofre da Attrio. A senha vai **só** no campo do painel, nunca neste arquivo.

Texto para colar (inglês):

> This is an internal tool for Study Quest staff. It requires signing in with a Study Quest Master Table account; a test account is provided below.
> 1. Install the extension and click its icon in the toolbar.
> 2. Sign in with the email and password below. The popup then shows "Conectado como <name>", the "Nova Resposta" form and the "Minhas Respostas" list.
> 3. Create a quick reply (Título, Texto da Resposta) and click "Adicionar Resposta Rápida"; it appears in the list. "Editar", "Excluir" and "Copiar" work on it.
> 4. The other features (insert a reply into a Zoho CRM note, notes panel, WhatsApp and copy buttons, field history) run inside the Study Quest Zoho CRM (crm.zoho.com / crm.zoho.eu), which requires a Study Quest Zoho account and cannot be provided to reviewers.
> 5. "Sair" signs out and the popup goes back to the sign-in card.
>
> Test account: email [a fornecer no painel] · password [a fornecer no painel]

## Antes de submeter

| Requisito | Estado |
|---|---|
| Servidor com `/api/auth/session` e Bearer em produção | 🔴 Pendente (trabalho paralelo na API; a 1.9.0 não funciona sem ele) |
| Feature flag `study_quest_extension` na Master Table | 🔴 Pendente (lado Master Table) |
| Conta de revisão na Master Table | 🔴 A criar pelo TI; senha no Cofre |
| Política publicada numa URL pública | ✅ https://attriostudio.com/privacidade-extensao-study-quest/ |
| Capturas 1280 × 800 | A produzir com dados fictícios |
| Pacote | `./scripts/build.sh` → `dist/study-quest-extension-chrome-1.9.0.zip` |

Documentação oficial: [publicar](https://developer.chrome.com/docs/webstore/publish) · [ficha](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) · [privacidade](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [distribuição](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
