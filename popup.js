// Popup.js - Gerenciamento de Quick Replies
(function () {
    'use strict';

    var SQ = globalThis.SQBrowser;
    var CFG = globalThis.SQConfig;

    var editingId = null;
    var currentAuthor = '';
    var submitting = false;

    document.addEventListener('DOMContentLoaded', function () {
        loadReplies();

        document.getElementById('replyForm').addEventListener('submit', handleSubmit);

        // Cache primeiro: o nome aparece mesmo se a aba ativa nao for o Zoho.
        SQ.storageGet(['zohoAuthor']).then(function (result) {
            if (result && result.zohoAuthor) {
                currentAuthor = result.zohoAuthor;
            }
        });

        // Se a aba ativa for o Zoho, pergunta ao content script o nome atual.
        SQ.activeTab().then(function (tab) {
            if (!tab || !tab.url || tab.url.indexOf('zoho') === -1) return;
            return SQ.sendMessageToTab(tab.id, { action: 'getAuthor' }).then(function (response) {
                if (response && response.author) {
                    currentAuthor = response.author;
                    SQ.storageSet({ zohoAuthor: currentAuthor });
                }
            });
        });

        showFieldHistoryStatus();

        // Alternar entre escolher categoria existente e criar uma nova
        var btnNew = document.getElementById('btnNewCategory');
        var btnCancel = document.getElementById('btnCancelCategory');
        var wrapSelect = document.getElementById('categorySelectWrap');
        var wrapInput = document.getElementById('categoryInputWrap');
        var catSelect = document.getElementById('replyCategory');
        var catInput = document.getElementById('newCategoryInput');

        btnNew.addEventListener('click', function () {
            wrapSelect.classList.add('is-hidden');
            wrapInput.classList.remove('is-hidden');
            catInput.focus();
        });

        btnCancel.addEventListener('click', function () {
            wrapInput.classList.add('is-hidden');
            wrapSelect.classList.remove('is-hidden');
            catInput.value = '';
        });

        // Botao de excluir categoria so aparece com uma categoria selecionada
        catSelect.addEventListener('change', function (e) {
            var btnDel = document.getElementById('btnDeleteCategory');
            if (e.target.value) {
                btnDel.classList.remove('is-hidden');
                btnDel.onclick = function () { deleteCategory(e.target.value); };
            } else {
                btnDel.classList.add('is-hidden');
                btnDel.onclick = null;
            }
        });
    });

    /** true quando o usuario esta digitando uma categoria nova. */
    function isCreatingCategory() {
        return !document.getElementById('categoryInputWrap').classList.contains('is-hidden');
    }

    function handleSubmit(e) {
        e.preventDefault();

        // Guarda sincrona: sem ela, o segundo clique antes da resposta chegar
        // dispara um POST duplicado e cria a resposta duas vezes.
        if (submitting) return;

        var title = document.getElementById('replyTitle').value.trim();
        var text = document.getElementById('replyText').value.trim();

        var category = isCreatingCategory()
            ? document.getElementById('newCategoryInput').value.trim()
            : document.getElementById('replyCategory').value;

        if (!category) category = 'Geral';

        if (!title || !text) {
            showAlert('Preencha o título e o texto da resposta antes de salvar.', 'error');
            return;
        }

        var author = currentAuthor || 'Sistema';

        var replyData = {
            id: editingId !== null ? editingId : Date.now().toString(),
            title: title,
            text: text,
            category: category,
            author: author
        };

        var isEditing = editingId !== null;
        var url = isEditing ? CFG.url('/replies/' + editingId) : CFG.url('/replies');
        var method = isEditing ? 'PUT' : 'POST';

        setSubmitting(true, isEditing);

        fetch(url, {
            method: method,
            headers: CFG.headers(true),
            body: JSON.stringify(replyData)
        })
            .then(readJsonOrThrow)
            .then(function () {
                showAlert(isEditing ? 'Resposta atualizada com sucesso!' : 'Resposta adicionada com sucesso!', 'success');
                resetForm();
                loadReplies();
            })
            .catch(function (err) {
                console.error('Study Quest Replies: falha ao salvar', err);
                showAlert(describeError(err, 'salvar a resposta'), 'error');
            })
            .then(function () {
                setSubmitting(false, false);
            });
    }

    function setSubmitting(active, isEditing) {
        submitting = active;
        var btn = document.getElementById('submitBtn');
        btn.disabled = active;
        if (active) {
            btn.textContent = isEditing ? 'Atualizando...' : 'Salvando...';
        } else {
            btn.textContent = editingId !== null ? 'Atualizar Resposta' : 'Adicionar Resposta Rápida';
        }
    }

    function resetForm() {
        editingId = null;
        document.getElementById('replyForm').reset();
        document.getElementById('categoryInputWrap').classList.add('is-hidden');
        document.getElementById('categorySelectWrap').classList.remove('is-hidden');
        document.getElementById('btnDeleteCategory').classList.add('is-hidden');
        document.getElementById('submitBtn').textContent = 'Adicionar Resposta Rápida';
    }

    /** Levanta erro com o motivo real do backend em vez de engolir num generico. */
    function readJsonOrThrow(res) {
        return res.text().then(function (body) {
            var data = null;
            try {
                data = body ? JSON.parse(body) : null;
            } catch (e) {
                data = null;
            }

            if (!res.ok) {
                var reason = (data && (data.error || data.message)) || body || ('HTTP ' + res.status);
                var err = new Error(reason);
                err.status = res.status;
                throw err;
            }

            if (data && data.error) throw new Error(data.error);
            return data;
        });
    }

    /** Monta mensagem com o que falhou, por que, e o que fazer. */
    function describeError(err, acao) {
        var status = err && err.status;
        var detail = (err && err.message) || 'motivo desconhecido';

        if (status === 401 || status === 403) {
            return 'Sem autorização para ' + acao + ': a chave da API foi recusada pelo servidor. Avise o suporte.';
        }
        if (status === 404) {
            return 'Não foi possível ' + acao + ': o registro não existe mais no servidor. Recarregue a lista.';
        }
        if (status >= 500) {
            return 'O servidor falhou ao ' + acao + ' (' + detail + '). Tente de novo em alguns minutos.';
        }
        if (!status) {
            // Sem status = o browser barrou antes da resposta (rede ou CORS).
            return 'Não foi possível ' + acao + ': sem conexão com o servidor (' + detail +
                '). Confira a internet; se persistir, veja se ' + CFG.API_BASE +
                ' responde sem redirecionar (redirect quebra o CORS da extensão).';
        }
        return 'Não foi possível ' + acao + ': ' + detail;
    }

    function loadReplies() {
        fetch(CFG.url('/replies'), { headers: CFG.headers(false) })
            .then(readJsonOrThrow)
            .then(function (replies) {
                replies = replies || [];

                var allCategories = [];
                replies.forEach(function (r) {
                    if (r.category && allCategories.indexOf(r.category) === -1) {
                        allCategories.push(r.category);
                    }
                });
                allCategories.sort();

                var catSelect = document.getElementById('replyCategory');
                var selected = catSelect.value;
                catSelect.textContent = '';
                catSelect.appendChild(makeOption('', 'Selecione uma categoria...', true));
                allCategories.forEach(function (cat) {
                    catSelect.appendChild(makeOption(cat, cat, false));
                });
                // Preserva a categoria escolhida quando ela ainda existe.
                if (selected && allCategories.indexOf(selected) !== -1) {
                    catSelect.value = selected;
                }

                renderReplies(replies);
            })
            .catch(function (err) {
                console.error('Study Quest Replies: erro ao carregar respostas', err);
                showEmptyState(describeError(err, 'carregar as respostas'));
            });
    }

    function makeOption(value, label, isPlaceholder) {
        var opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        if (isPlaceholder) {
            opt.disabled = true;
            opt.selected = true;
        }
        return opt;
    }

    function showEmptyState(message) {
        var listContainer = document.getElementById('repliesList');
        listContainer.textContent = '';
        var div = document.createElement('div');
        div.className = 'empty-state';
        div.textContent = message;
        listContainer.appendChild(div);
    }

    function renderReplies(replies) {
        var listContainer = document.getElementById('repliesList');

        if (!replies.length) {
            showEmptyState('Nenhuma resposta rápida cadastrada. Adicione sua primeira resposta acima!');
            return;
        }

        listContainer.textContent = '';

        replies.forEach(function (reply) {
            var item = document.createElement('div');
            item.className = 'reply-item';

            var title = document.createElement('div');
            title.className = 'reply-title';
            title.appendChild(document.createTextNode(reply.title || ''));

            var badge = document.createElement('span');
            badge.className = 'reply-badge';
            badge.textContent = reply.category || 'Geral';
            title.appendChild(badge);

            var text = document.createElement('div');
            text.className = 'reply-text';
            text.textContent = reply.text || '';

            var author = document.createElement('div');
            author.className = 'reply-author';
            author.textContent = 'Por: ' + (reply.author || 'User');

            var actions = document.createElement('div');
            actions.className = 'reply-actions';

            var btnEdit = document.createElement('button');
            btnEdit.type = 'button';
            btnEdit.className = 'btn-small btn-edit';
            btnEdit.textContent = 'Editar';
            btnEdit.addEventListener('click', function () { editReply(reply); });

            var btnDelete = document.createElement('button');
            btnDelete.type = 'button';
            btnDelete.className = 'btn-small btn-delete';
            btnDelete.textContent = 'Excluir';
            btnDelete.addEventListener('click', function () { deleteReply(reply.id); });

            actions.appendChild(btnEdit);
            actions.appendChild(btnDelete);

            item.appendChild(title);
            item.appendChild(text);
            item.appendChild(author);
            item.appendChild(actions);

            listContainer.appendChild(item);
        });
    }

    /**
     * Preenche o formulario com a resposta escolhida.
     * Recebe o objeto ja carregado — antes isso refazia um GET na lista inteira
     * so para reencontrar o mesmo registro que ja estava em memoria.
     */
    function editReply(reply) {
        document.getElementById('replyTitle').value = reply.title || '';
        document.getElementById('replyText').value = reply.text || '';

        var catSelect = document.getElementById('replyCategory');
        var catInput = document.getElementById('newCategoryInput');
        var wrapSelect = document.getElementById('categorySelectWrap');
        var wrapInput = document.getElementById('categoryInputWrap');

        var optionExists = false;
        for (var i = 0; i < catSelect.options.length; i++) {
            if (catSelect.options[i].value === reply.category) {
                optionExists = true;
                catSelect.selectedIndex = i;
                break;
            }
        }

        if (!optionExists && reply.category) {
            // Categoria que nao esta na lista: mostra no campo de texto.
            wrapSelect.classList.add('is-hidden');
            wrapInput.classList.remove('is-hidden');
            catInput.value = reply.category;
        } else {
            wrapInput.classList.add('is-hidden');
            wrapSelect.classList.remove('is-hidden');
            catInput.value = '';
        }

        editingId = reply.id;
        document.getElementById('submitBtn').textContent = 'Atualizar Resposta';

        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('replyTitle').focus();
    }

    function deleteReply(id) {
        if (!confirm('Tem certeza que deseja excluir esta resposta rápida?')) {
            return;
        }

        fetch(CFG.url('/replies/' + id), {
            method: 'DELETE',
            headers: CFG.headers(false)
        })
            .then(function (res) {
                if (!res.ok) {
                    var err = new Error('HTTP ' + res.status);
                    err.status = res.status;
                    throw err;
                }
                showAlert('Resposta excluída com sucesso!', 'success');
                if (editingId === id) resetForm();
                loadReplies();
            })
            .catch(function (err) {
                console.error('Study Quest Replies: falha ao excluir', err);
                showAlert(describeError(err, 'excluir a resposta'), 'error');
            });
    }

    function deleteCategory(name) {
        if (!confirm('ATENÇÃO: Você está prestes a excluir a categoria "' + name + '" e TODAS as respostas nela contidas. Tem certeza?')) {
            return;
        }

        fetch(CFG.url('/categories/' + encodeURIComponent(name)), {
            method: 'DELETE',
            headers: CFG.headers(false)
        })
            .then(function (res) {
                if (!res.ok) {
                    var err = new Error('HTTP ' + res.status);
                    err.status = res.status;
                    throw err;
                }
                showAlert('Categoria excluída com sucesso!', 'success');
                resetForm();
                loadReplies();
            })
            .catch(function (err) {
                console.error('Study Quest Replies: falha ao excluir categoria', err);
                showAlert(describeError(err, 'excluir a categoria'), 'error');
            });
    }

    var alertTimer = null;

    function showAlert(message, type) {
        var alertDiv = document.getElementById('alert');
        alertDiv.className = 'alert alert-' + type;
        alertDiv.textContent = message;
        alertDiv.classList.remove('hidden');

        if (alertTimer) clearTimeout(alertTimer);
        // Erro fica mais tempo na tela: costuma ter texto para ler.
        alertTimer = setTimeout(function () {
            alertDiv.classList.add('hidden');
        }, type === 'error' ? 8000 : 3000);
    }

    /**
     * Diagnostico do historico de campo: so aparece quando a aba ativa e um
     * Deal ou Lead do Zoho. Em qualquer outra tela o bloco fica escondido —
     * secao vazia num popup de gestao de respostas so confunde.
     *
     * Texto sempre por `textContent`: o conteudo vem do content script (nome do
     * campo, mensagem de erro do Zoho) e nao pode virar HTML dentro do popup.
     */
    function showFieldHistoryStatus() {
        var box = document.getElementById('fieldHistory');
        var line = document.getElementById('fieldHistoryStatus');
        if (!box || !line) return;

        SQ.activeTab().then(function (tab) {
            if (!tab || !tab.url || tab.url.indexOf('zoho') === -1) return null;
            return SQ.sendMessageToTab(tab.id, { action: 'fieldHistoryStatus' });
        }).then(function (s) {
            if (!s || !s.page) return;
            var texto;
            if (s.apiError) {
                texto = 'Registro ' + s.page + '. O Zoho recusou a leitura direta ('
                    + s.apiError + '), entao estou usando a aba Timeline — '
                    + s.scraped + ' alteracoes lidas ate agora.';
            } else if (!s.icons) {
                texto = 'Registro ' + s.page + ', mas nenhum icone de relogio foi colocado ainda. '
                    + 'Atualize a pagina; se continuar em zero, me mande um print desta caixa.';
            } else {
                texto = 'Registro ' + s.page + ' — ' + s.icons
                    + (s.icons === 1 ? ' icone de relogio na tela.' : ' icones de relogio na tela.');
            }
            line.textContent = texto;
            line.classList.toggle('field-history-error', !!s.apiError || !s.icons);
            box.classList.remove('is-hidden');
        });
    }
})();
