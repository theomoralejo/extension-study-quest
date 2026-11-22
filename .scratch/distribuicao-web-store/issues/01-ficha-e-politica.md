Status: backlog
Blocked by: nenhum

# 01 · Ficha da loja e política de privacidade

- Confirmar conta de desenvolvedor da Attrio na Chrome Web Store (taxa única US$ 5).
- Ficha: nome, descrição, ícones, screenshots. Reaproveitar o modelo da extensão Attrio
  (`/Users/theomoralejo/Dev/_wt-extensao-cws/docs/proposta-ficha-chrome-web-store-2026-10-07.md`
  e `proposta-justificativa-permissoes-chrome-web-store-2026-10-17.md`).
- Justificar cada permissão (`storage`, `activeTab`, `clipboardWrite`, hosts Zoho e `cv.*`).
- Declarar coleta de dados pessoais (lê dados do Zoho CRM da Study Quest).
- Política de privacidade publicada em URL pública.

## Comments

- 22/nov/2026 (branch `feat/login-master-table`, versão 1.9.0): material da loja preparado, nada submetido.
  - Ficha (nome, resumo e descrição em pt-BR e inglês, categoria, visibilidade **Não listada**, capturas 1280×800 a produzir, instruções de teste com conta de revisão da Master Table "[a fornecer no painel]"): `docs/ficha-chrome-web-store.md`.
  - Propósito único, justificativa de cada permissão e host do manifesto 1.9.0 e tipos de dados (PII, autenticação, conteúdo do site): `docs/justificativa-permissoes-chrome-web-store.md`.
  - Texto da política de privacidade (Attrio Studio para a Study Quest; Zoho, `cv.attriostudio.com`, `api.master.studyquestuk.com`, storage local, sem venda nem anúncio): `docs/spec-politica-privacidade-extensao.md`. Falta publicar numa URL pública.
  - Pacote sem a chave antiga: `./scripts/build.sh` → `dist/study-quest-extension-chrome-1.9.0.zip` (portão em `tests/test-sessao.mjs`).
  - Pendente antes do envio: API com `/api/auth/session` em produção, flag `study_quest_extension` na Master Table, conta de revisão, URL da política, capturas.
