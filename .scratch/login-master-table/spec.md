CRM: loc:local-68a49025-1b91-4b56-854c-c74756e38869 (CRM da Attrio, client.attriostudio.com)

# Login da Master Table na extensão + pacote da Chrome Web Store

**Pedido (Theo, 22/nov/2026):** entrar na extensão com o e-mail e a senha da Master Table, trocar a
chave fixa da API das respostas por sessão por pessoa conferida no servidor, e preparar o pacote da
Chrome Web Store como **não listado**.

## Por quê (incidente)

O repositório `theomoralejo/extension-study-quest` é **público** e `config.js` carrega a chave fixa
`x-api-key`. Medido em 22/nov/2026: `GET https://cv.attriostudio.com/api/replies` com essa chave = 200.
Qualquer pessoa lê, edita e apaga as respostas (inclusive categoria inteira).

## Desenho

```mermaid
sequenceDiagram
  participant P as Popup da extensão
  participant MT as Master Table (PocketBase 0.25.9)
  participant API as study-quest-api (cv.attriostudio.com)
  P->>MT: POST /api/collections/users/auth-with-password {identity,password}
  MT-->>P: {token PB, record}
  P->>API: POST /api/auth/session {pbToken}
  API->>MT: GET /api/attrio/extensao-study-quest/me (Authorization: pbToken)
  MT-->>API: 200 {id,name,email} | 401 | 403
  API-->>P: 201 {token da extensão, name, email, expiresAt}
  Note over P: guarda só o token da extensão; o token PB é descartado
  P->>API: /api/replies (Authorization: Bearer token)
```

- **A senha vai só para a Master Table**, como no login do próprio app. A API das respostas nunca a vê.
- **O token PB (acesso total à Master Table) não fica na extensão.** O que fica é um token próprio, que só
  abre as respostas rápidas, guardado como hash SHA-256 na tabela `extension_sessions` (MySQL), 30 dias.
- **Quem pode usar** é a feature flag `study_quest_extension` da Master Table (Users & Roles → Feature flags),
  regra RBAC explícita (flag desligada ou listas vazias = ninguém), conferida no servidor da Master Table.
  Nasce com todos os papéis do app (o mesmo público de hoje).
- **Autor** da resposta passa a vir do login (servidor), não do nome lido na tela do Zoho.

## Contrato

### Master Table
`GET /api/attrio/extensao-study-quest/me`, header `Authorization: <token PB>`
- 401 `{error}`: sem sessão ou sessão expirada.
- 403 `{error}`: conta fora da coleção `users`, `inactive`, ou sem a flag.
- 200 `{id, name, email}`. Sempre `Cache-Control: no-store`.

### study-quest-api
- `POST /api/auth/session` `{pbToken}` → 201 `{token, name, email, expiresAt}` · 400 · 401 · 403 (mensagem da Master Table) · 502/503.
- `GET /api/auth/session` (Bearer) → 200 `{name, email, expiresAt}` · 401.
- `DELETE /api/auth/session` (Bearer) → 204.
- `/api/replies*`, `/api/categories*`: `Authorization: Bearer <token>`; sem sessão válida → 401 `{error, code:"sessao"}`.
- Transição: `ACEITAR_CHAVE_ANTIGA=1` no `.env` aceita a `x-api-key` antiga enquanto o time troca de versão;
  cada uso vai ao log. Desligar assim que o time estiver na versão da loja.

### Extensão
- Sessão em `storage.local` na chave `sqSessao` = `{token, name, email, expiresAt}`.
- 401 de qualquer chamada apaga `sqSessao` e volta para a tela de login.

## Limites aceitos
- Tirar a flag de alguém na Master Table vale no próximo login; a sessão já emitida dura até 30 dias
  (revogar antes: apagar as linhas dela em `extension_sessions`).
- `storage.local` é legível pelos content scripts da própria extensão (não pela página do Zoho). Aceito porque
  o token só abre as respostas rápidas.

## Aceite
- Sem login, a API recusa (401) e o painel e o popup pedem login.
- Login com conta da Master Table com a flag: tudo funciona como antes; autor = nome da Master Table.
- Conta sem flag ou inativa: mensagem clara, sem acesso.
- Pacote `dist/` da loja sem a chave, com ficha, justificativa de permissões e política de privacidade prontas.
