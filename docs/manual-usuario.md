# Manual do usuário — Study Quest Extension

## Respostas rápidas com campos do registro (`#Campo`)
1. Clique no ícone da extensão e preencha **Título** e **Texto da Resposta**.
2. Para puxar um dado do Deal, digite `#` e o começo do campo (ex.: `#st`). A lista sugere os campos: setas para escolher, Enter ou Tab para completar, Esc para fechar.
3. Não sabe o nome? Com um registro aberto no Zoho, clique em **Inserir campo**, busque e clique no campo. Ele entra onde está o cursor e mostra o valor deste registro.
4. Ao inserir a resposta numa nota, cada `#Campo` vira o valor do registro aberto. Campo vazio no Deal some do texto. Hashtag que não é campo (ex.: `#StudyQuest`) fica como está.
5. Se o Zoho não liberar os dados (sessão expirada, sem permissão), a resposta entra como está e aparece um aviso vermelho dizendo o motivo.

## Copiar uma resposta
Em **Minhas Respostas**, o botão **Copiar** (ao lado de Editar e Excluir) copia o título e o texto (o título na primeira linha, uma linha em branco, depois o texto), já com os `#Campo` trocados pelos dados do Deal aberto na aba. O botão mostra "Copiado" por 1,5 s. Sem Deal aberto, copia como está e o popup avisa.

Com um Deal aberto na aba, a lista **Minhas Respostas** (popup) e o painel de respostas dentro do Zoho já mostram cada resposta com os dados dele (o que aparece é o que o Copiar leva). O modelo com os `#Campo` aparece ao clicar em Editar.

Se o popup pedir para recarregar a página do Zoho, aperte F5 na aba do Zoho: isso acontece logo depois de atualizar a extensão.

## Quem criou a resposta
A resposta nova é assinada com o usuário logado no Zoho da aba aberta. Editar uma resposta mantém quem a criou. Respostas salvas antes da 1.7.5 com o nome errado continuam com ele: edite o nome no backend ou recrie a resposta.

## Notas: menções e portal do cliente
- Quem foi mencionado com `@` aparece com o nome em **negrito azul**. O nome não é link.
- Nota compartilhada com o cliente mostra o selo verde **Visível no portal do cliente** ao lado do autor, sempre (também durante Editar e Excluir).

## Mover os painéis
- Arraste o painel de **Notas** ou o de **respostas rápidas** pelo cabeçalho. A posição fica salva.
- Duplo clique no cabeçalho volta o painel ao lugar padrão.
- No cabeçalho do painel de **Notas**, as setas **←** e **→** encostam o painel direto na borda esquerda ou direita, de cima a baixo. Encostado à direita aparece só a **←**; à esquerda, só a **→**; solto, as duas.
- Para mudar o tamanho do painel de **Notas**, arraste o canto de baixo (largura e altura juntas). Encostado à direita, o canto fica à esquerda; encostado à esquerda, à direita; solto, os dois. O tamanho fica salvo.
- Recolhido, a aba **Notas** fica na borda direita; arraste-a para cima ou para baixo.
- O painel continua aberto (ou recolhido) como você deixou, e o rascunho volta, mesmo trocando de página ou recarregando.

## Colar texto grande numa nota
A extensão não mexe no texto que está sendo escrito ou colado numa nota do Zoho. Até a 1.7.4 ela punha ícones dentro do texto colado e a tela travava com textos longos.

## Depois de atualizar a extensão
Com o Zoho aberto durante a atualização, a extensão some da aba e aparece o aviso "Study Quest foi atualizada: recarregue a página (F5) para voltar a usar". Aperte F5 na aba do Zoho. Até a 1.7.5 isso gerava erros "Extension context invalidated" em chrome://extensions → Erros; eles não afetavam o uso e podem ser apagados.

## Desempenho
A partir da 1.7.0 a extensão só trabalha no que mudou na tela e para quando a aba do Zoho está em segundo plano.
