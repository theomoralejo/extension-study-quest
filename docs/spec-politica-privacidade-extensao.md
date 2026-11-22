# Política de privacidade da Study Quest Extension

**Texto pronto para publicar numa URL pública (versão 1.9.0, 22/nov/2026).** Abaixo, o texto que vai ao ar.

---

A Study Quest Extension é uma ferramenta interna da Study Quest, desenvolvida e operada pela Attrio Studio,
Moralejo Web Design LTDA, CNPJ 37.711.494/0001-22, para uso da equipe da Study Quest no Zoho CRM da empresa.
Ela só funciona para pessoas com conta ativa na Master Table da Study Quest e acesso liberado à extensão.

## O que a extensão lê nas páginas do Zoho CRM

Nas páginas do Zoho CRM (`/crm/`), a extensão lê, pela sessão do Zoho que você já tem aberta na aba:
os campos do registro aberto (para trocar `#Campo` pelo valor nas respostas rápidas e montar o cabeçalho do Deal),
as notas do registro (para o painel de notas), a linha do tempo de alterações (para o histórico de campo) e os
telefones da tela (para o botão de WhatsApp). Esses dados ficam entre o seu navegador e o Zoho: a extensão não os
envia a servidores da Attrio nem da Study Quest. O botão de WhatsApp, quando você clica nele, abre o `wa.me` com
aquele número, como qualquer link de WhatsApp. Notas e campos que você edita pela extensão são gravados no próprio Zoho.

## O que vai para a Master Table (`api.master.studyquestuk.com`)

Ao clicar em **Entrar**, o e-mail e a senha que você digitou vão, por HTTPS, só para a Master Table da Study Quest,
como no login do próprio app. A extensão não guarda a senha.

## O que vai para o servidor das respostas rápidas (`cv.attriostudio.com`)

- No login, o token temporário devolvido pela Master Table, para o servidor confirmar quem você é e se a sua conta
  tem acesso à extensão. O servidor devolve um token próprio da extensão, que só abre as respostas rápidas e vale
  até 30 dias; ele é guardado no servidor apenas como hash.
- No uso, as respostas rápidas que você cria, edita ou apaga (título, texto, categoria). Cada resposta leva o nome
  da pessoa logada como autor, visível para a equipe.
- Ao clicar em **Sair**, o pedido para encerrar a sessão.

## O que fica guardado no seu navegador

No armazenamento local da extensão: a sessão (token, nome, e-mail e validade), a posição em que você deixou os
painéis, os nomes dos campos do último registro aberto (sem os valores) e o histórico de alterações lido da linha
do tempo de cada registro. Na própria aba do Zoho: o rascunho da nota que você está escrevendo e se a caixa
"Important notes" está aberta. Clicar em **Sair** apaga a sessão; remover a extensão apaga tudo o que ela guardou.

## O que a extensão não faz

Não vende dados, não usa dados para publicidade, não rastreia a navegação fora do Zoho CRM, não carrega código de
fora do pacote e não compartilha dados com terceiros além da Master Table e do Zoho, que você já usa no trabalho.

## Retenção, acesso e contato

As respostas rápidas ficam no servidor enquanto a equipe as usar. As sessões vencem em 30 dias. O acesso à
extensão é controlado pela Study Quest na Master Table. Para suporte, dúvidas ou pedidos de exclusão de dados,
escreva para `info@attriostudio.com`. Mudanças relevantes nesta política serão publicadas nesta página.
