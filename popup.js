// Popup.js - Gerenciamento de Quick Replies
(function () {
    'use strict';

    var SQ = globalThis.SQBrowser;
    var CFG = globalThis.SQConfig;

    var editingId = null;
    var editingAuthor = null; // editar nao troca quem criou a resposta
    var currentAuthor = '';
    var authorReady = null;   // nome do usuario logado no Zoho, pela aba ativa
    var submitting = false;

    document.addEventListener('DOMContentLoaded', function () {
        loadReplies();

        document.getElementById('replyForm').addEventListener('submit', handleSubmit);

        // Cache primeiro: o nome aparece mesmo se a aba ativa nao for o Zoho.
        // O cache nunca sobrescreve o nome que a aba do Zoho ja respondeu.
        SQ.storageGet(['zohoAuthor']).then(function (result) {
            if (result && result.zohoAuthor && !currentAuthor) {
                currentAuthor = result.zohoAuthor;
            }
        });

        // Se a aba ativa for o Zoho, pergunta ao content script o nome atual.
        authorReady = SQ.activeTab().then(function (tab) {
            if (!tab || !tab.url || tab.url.indexOf('zoho') === -1) return;
            return SQ.sendMessageToTab(tab.id, { action: 'getAuthor' }).then(function (response) {
                if (response && response.author) {
                    currentAuthor = response.author;
                    SQ.storageSet({ zohoAuthor: currentAuthor });
                }
            });
        });

        showFieldHistoryStatus();
        setupFieldPicker();
        setupAutocomplete();

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

        var isEditing = editingId !== null;
        var url = isEditing ? CFG.url('/replies/' + editingId) : CFG.url('/replies');
        var method = isEditing ? 'PUT' : 'POST';
        var id = isEditing ? editingId : Date.now().toString();

        setSubmitting(true, isEditing);

        // Espera o nome do usuario logado: salvar antes dele chegar assinava com o nome em cache.
        Promise.resolve(authorReady).catch(function () {}).then(function () {
            var replyData = {
                id: id,
                title: title,
                text: text,
                category: category,
                author: (isEditing && editingAuthor) || currentAuthor || 'Sistema'
            };
            return fetch(url, {
                method: method,
                headers: CFG.headers(true),
                body: JSON.stringify(replyData)
            });
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
        editingAuthor = null;
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
        var textEls = [];

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
            textEls.push({ el: text, raw: reply.text || '' });

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

            var btnCopy = document.createElement('button');
            btnCopy.type = 'button';
            btnCopy.className = 'btn-small btn-copy';
            btnCopy.textContent = 'Copiar';
            btnCopy.title = 'Copiar título e texto da resposta';
            btnCopy.addEventListener('click', function () { copyReply(reply, btnCopy); });

            actions.appendChild(btnCopy);
            actions.appendChild(btnEdit);
            actions.appendChild(btnDelete);

            item.appendChild(title);
            item.appendChild(text);
            item.appendChild(author);
            item.appendChild(actions);

            listContainer.appendChild(item);
        });
        previewFilled(textEls);
    }

    var TOKEN_RE = /#[A-Za-z][A-Za-z0-9_]*/;

    /**
     * Pede a aba ativa do Zoho os textos com os #campos trocados pelo registro aberto.
     * Resolve { status, texts, error }; 'sem-resposta' = aba aberta antes de a
     * extensao ser atualizada (content script antigo nao responde ate recarregar).
     */
    function fillFromTab(texts) {
        return SQ.activeTab().then(function (tab) {
            if (!tab || !tab.url || !/^https:\/\/[^/]*zoho/.test(tab.url)) return { status: 'sem-registro', texts: texts };
            return SQ.sendMessageToTab(tab.id, { action: 'fillText', texts: texts }).then(function (res) {
                return res && res.texts ? res : { status: 'sem-resposta', texts: texts };
            });
        }).catch(function (e) { return { status: 'erro', texts: texts, error: e.message }; });
    }

    function fillProblem(res) {
        if (res.status === 'erro') return 'O Zoho recusou a leitura do registro (' + res.error + '). Confira se você está logado no Zoho.';
        if (res.status === 'sem-resposta') return 'Recarregue a página do Zoho (F5) para preencher os #campos: a extensão foi atualizada e a aba ainda está com a versão antiga.';
        return 'Abra um Deal (ou Lead) no Zoho nesta aba para preencher os #campos.';
    }

    /** O que aparece na lista e o que o Copiar leva: o texto ja preenchido com o registro aberto. */
    function previewFilled(textEls) {
        var note = document.getElementById('fillNote');
        var withTokens = textEls.filter(function (t) { return TOKEN_RE.test(t.raw); });
        if (!withTokens.length) { note.classList.add('is-hidden'); return; }
        fillFromTab(withTokens.map(function (t) { return t.raw; })).then(function (res) {
            note.classList.remove('is-hidden');
            if (res.status !== 'ok') {
                note.className = 'fill-note is-warn';
                note.textContent = fillProblem(res);
                return;
            }
            withTokens.forEach(function (t, i) { t.el.textContent = res.texts[i]; t.el.title = 'Modelo: ' + t.raw; });
            note.className = 'fill-note';
            note.textContent = 'Mostrando com os dados do registro aberto. O modelo com os #campos aparece em Editar.';
        });
    }

    /**
     * Copia titulo + texto, com os #campos ja trocados pelos dados do registro
     * aberto na aba. Sem registro, copia como esta e avisa.
     */
    function copyReply(reply, btn) {
        var raw = [reply.title || '', reply.text || ''];
        var join = function (t) { return t[0] ? t[0] + '\n\n' + t[1] : t[1]; };
        if (!TOKEN_RE.test(raw.join(' '))) { writeClipboard(join(raw), btn, null); return; }
        btn.textContent = 'Copiando...';
        fillFromTab(raw).then(function (res) {
            if (res.status === 'ok') { writeClipboard(join(res.texts), btn, null); return; }
            writeClipboard(join(raw), btn, 'Copiado sem os dados do registro. ' + fillProblem(res));
        });
    }

    /** Clipboard API primeiro, textarea + execCommand se ela recusar. `warn` vira aviso depois de copiar. */
    function writeClipboard(text, btn, warn) {
        var done = function (ok) {
            if (!ok) { btn.textContent = 'Copiar'; showAlert('Não foi possível copiar: o navegador bloqueou a área de transferência. Selecione o texto e use Ctrl/⌘ + C.', 'error'); return; }
            if (warn) showAlert(warn, 'error');
            btn.textContent = 'Copiado';
            btn.classList.add('is-copied');
            setTimeout(function () { btn.textContent = 'Copiar'; btn.classList.remove('is-copied'); }, 1500);
        };
        var fallback = function () {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            ta.remove();
            done(ok);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        } else {
            fallback();
        }
    }

    // ---------- #Campo: campos do registro aberto no Zoho ----------
    var fieldsLoaded = null; // { module, fields } do registro da aba ativa

    function setupFieldPicker() {
        var btn = document.getElementById('btnFields');
        var picker = document.getElementById('fieldPicker');
        var search = document.getElementById('fieldSearch');

        btn.addEventListener('click', function () {
            var open = picker.classList.contains('is-hidden');
            picker.classList.toggle('is-hidden', !open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open) return;
            search.focus();
            if (!fieldsLoaded) loadFields();
        });
        search.addEventListener('input', renderFields);
        search.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); btn.click(); btn.focus(); }
        });
    }

    function pickerStatus(text) {
        document.getElementById('fieldPickerStatus').textContent = text;
    }

    var FIELDS_CACHE = 'sqFieldsCache';
    var fieldsPromise = null;

    /**
     * Campos do registro aberto. Sem registro na aba, usa a ultima lista vista
     * (sem valores), para o autocompletar funcionar com o popup aberto em qualquer aba.
     */
    function getFields() {
        if (fieldsPromise) return fieldsPromise;
        fieldsPromise = SQ.activeTab().then(function (tab) {
            if (!tab || !tab.url || tab.url.indexOf('zoho') === -1) return null;
            return SQ.sendMessageToTab(tab.id, { action: 'recordFields' });
        }).then(function (res) {
            if (res && res.fields) {
                var cache = {};
                cache[FIELDS_CACHE] = { module: res.module, fields: res.fields.map(function (f) { return { api: f.api, label: f.label }; }) };
                SQ.storageSet(cache);
                return res;
            }
            return SQ.storageGet([FIELDS_CACHE]).then(function (c) {
                var cached = c && c[FIELDS_CACHE];
                if (cached && cached.fields && cached.fields.length) { cached.cached = true; return cached; }
                return res; // null ou { error }
            });
        });
        return fieldsPromise;
    }

    function loadFields() {
        pickerStatus('Carregando campos do registro...');
        document.getElementById('fieldSearch').disabled = true;
        getFields().then(function (res) {
            document.getElementById('fieldSearch').disabled = false;
            if (res && res.error) {
                fieldsPromise = null; // falha nao fica em cache: tenta de novo no proximo clique
                pickerStatus('O Zoho não devolveu os campos (' + res.error + '). Confira se você está logado e tente de novo.');
                return;
            }
            if (!res || !res.fields) {
                pickerStatus('Abra um registro do Zoho (Deal, Lead, Contact...) nesta aba para listar os campos. Você também pode digitar #Nome_API direto no texto.');
                return;
            }
            fieldsLoaded = res;
            renderFields();
        });
    }

    function renderFields() {
        var list = document.getElementById('fieldList');
        list.textContent = '';
        if (!fieldsLoaded) return;
        var q = document.getElementById('fieldSearch').value.trim().toLowerCase();
        var shown = fieldsLoaded.fields.filter(function (f) {
            return !q || f.label.toLowerCase().indexOf(q) !== -1 || f.api.toLowerCase().indexOf(q) !== -1;
        });
        pickerStatus(shown.length
            ? 'Campos de ' + fieldsLoaded.module + (fieldsLoaded.cached ? ' · abra o registro no Zoho para ver os valores' : ' · o valor abaixo é o deste registro')
            : 'Nenhum campo com "' + q + '". Limpe a busca para ver todos.');
        shown.forEach(function (f) {
            var li = document.createElement('li');
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'field-item';
            var top = document.createElement('div');
            top.className = 'field-item-top';
            var label = document.createElement('span');
            label.textContent = f.label;
            var code = document.createElement('code');
            code.textContent = '#' + f.api;
            top.appendChild(label);
            top.appendChild(code);
            var val = document.createElement('div');
            val.className = 'field-item-value';
            val.textContent = fieldsLoaded.cached ? '' : (f.value || '(vazio neste registro)');
            b.appendChild(top);
            b.appendChild(val);
            b.addEventListener('click', function () { insertToken('#' + f.api); });
            li.appendChild(b);
            list.appendChild(li);
        });
    }

    // ---------- autocompletar: digitar #ca sugere os campos ----------
    var suggest = { open: false, items: [], active: 0, start: 0 };

    /** `#texto` logo antes do cursor, comecando no inicio ou depois de espaco/pontuacao. */
    function tokenAtCaret(ta) {
        var before = ta.value.slice(0, ta.selectionStart);
        var m = before.match(/(^|[^A-Za-z0-9_#@])#([A-Za-z0-9_]*)$/); // # depois de letra ou @ (e-mail) nao e campo
        return m ? { query: m[2], start: before.length - m[2].length - 1 } : null;
    }

    function rankFields(fields, q) {
        q = q.toLowerCase();
        var starts = [], contains = [];
        fields.forEach(function (f) {
            var api = f.api.toLowerCase(), label = f.label.toLowerCase();
            if (!q || api.indexOf(q) === 0 || label.indexOf(q) === 0) starts.push(f);
            else if (api.indexOf(q) !== -1 || label.indexOf(q) !== -1) contains.push(f);
        });
        return starts.concat(contains).slice(0, 8);
    }

    function setupAutocomplete() {
        var ta = document.getElementById('replyText');
        var box = document.getElementById('fieldSuggest');

        var seq = 0, blurTimer = null;
        function update() {
            var tok = tokenAtCaret(ta);
            var mine = ++seq;
            if (!tok) { closeSuggest(); return; }
            getFields().then(function (res) {
                // so a tecla mais recente desenha a lista: resposta atrasada de "#d" nao redesenha "#de"
                if (mine !== seq || tokenAtCaret(ta) === null) return;
                suggest.start = tok.start;
                suggest.items = res && res.fields ? rankFields(res.fields, tok.query) : [];
                suggest.active = 0;
                suggest.empty = !(res && res.fields)
                    ? 'Abra um registro do Zoho nesta aba para ver os campos.'
                    : 'Nenhum campo com "' + tok.query + '".';
                renderSuggest();
            });
        }

        ta.addEventListener('input', update);
        ta.addEventListener('click', update);
        // fechar ao sair do campo, mas nao se o foco ja voltou (o atraso deixa o clique na lista chegar)
        ta.addEventListener('blur', function () { blurTimer = setTimeout(closeSuggest, 150); });
        ta.addEventListener('focus', function () { clearTimeout(blurTimer); });
        ta.addEventListener('keydown', function (e) {
            if (!suggest.open) return;
            if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
            if (!suggest.items.length) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                var n = suggest.items.length;
                suggest.active = (suggest.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
                renderSuggest();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pickSuggest(suggest.items[suggest.active]);
            }
        });
        // mousedown + preventDefault: o clique escolhe sem tirar o foco do campo
        box.addEventListener('mousedown', function (e) {
            var li = e.target.closest('[data-api]');
            if (!li) return;
            e.preventDefault();
            pickSuggest(suggest.items[Number(li.dataset.index)]);
        });
    }

    function renderSuggest() {
        var ta = document.getElementById('replyText');
        var box = document.getElementById('fieldSuggest');
        box.textContent = '';
        if (!suggest.items.length) {
            var li = document.createElement('li');
            li.className = 'suggest-empty';
            li.textContent = suggest.empty;
            box.appendChild(li);
        }
        suggest.items.forEach(function (f, i) {
            var li = document.createElement('li');
            li.id = 'suggest-' + i;
            li.className = 'suggest-item' + (i === suggest.active ? ' is-active' : '');
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', i === suggest.active ? 'true' : 'false');
            li.dataset.api = f.api;
            li.dataset.index = i;
            var label = document.createElement('span');
            label.textContent = f.label;
            var code = document.createElement('code');
            code.textContent = '#' + f.api;
            li.appendChild(label);
            li.appendChild(code);
            box.appendChild(li);
        });
        box.classList.remove('is-hidden');
        suggest.open = true;
        ta.setAttribute('aria-expanded', 'true');
        if (suggest.items.length) {
            ta.setAttribute('aria-activedescendant', 'suggest-' + suggest.active);
            var act = document.getElementById('suggest-' + suggest.active);
            if (act) act.scrollIntoView({ block: 'nearest' });
        } else {
            ta.removeAttribute('aria-activedescendant');
        }
    }

    function closeSuggest() {
        var ta = document.getElementById('replyText');
        document.getElementById('fieldSuggest').classList.add('is-hidden');
        suggest.open = false;
        ta.setAttribute('aria-expanded', 'false');
        ta.removeAttribute('aria-activedescendant');
    }

    /** Troca o `#parcial` digitado pelo campo escolhido, com espaco depois. */
    function pickSuggest(f) {
        if (!f) return;
        var ta = document.getElementById('replyText');
        var end = ta.selectionStart;
        var token = '#' + f.api + ' ';
        var after = ta.value.slice(end).replace(/^[A-Za-z0-9_]*/, '');
        if (after.charAt(0) === ' ') token = token.trimEnd();
        ta.value = ta.value.slice(0, suggest.start) + token + after;
        var pos = suggest.start + token.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        closeSuggest();
    }

    /** Coloca o token no cursor do "Texto da Resposta", com espaco antes quando colado em palavra. */
    function insertToken(token) {
        var ta = document.getElementById('replyText');
        var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        var end = ta.selectionEnd != null ? ta.selectionEnd : start;
        var before = ta.value.slice(0, start);
        if (before && !/\s$/.test(before)) token = ' ' + token;
        ta.value = before + token + ta.value.slice(end);
        var pos = start + token.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
    }

    /**
     * Preenche o formulario com a resposta escolhida.
     * Recebe o objeto ja carregado — antes isso refazia um GET na lista inteira
     * so para reencontrar o mesmo registro que ja estava em memoria.
     */
    function editReply(reply) {
        editingAuthor = reply.author || null;
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

        var isZohoCrm = false;
        SQ.activeTab().then(function (tab) {
            if (!tab || !tab.url || tab.url.indexOf('zoho') === -1) return null;
            isZohoCrm = /\/crm\//.test(tab.url);
            return SQ.sendMessageToTab(tab.id, { action: 'fieldHistoryStatus' });
        }).then(function (s) {
            // Aba do Zoho CRM sem resposta = a extensao nao esta rodando na pagina:
            // sem bolinha de templates, sem aba Notas, sem relogio. O popup diz como resolver.
            if (!s && isZohoCrm) {
                line.textContent = 'A extensão não está rodando nesta aba do Zoho, por isso não aparecem '
                    + 'a bolinha dos templates, a aba Notas e o relógio. Recarregue a página (F5). '
                    + 'Se continuar: chrome://extensions → Study Quest Extension → Detalhes → '
                    + 'Acesso ao site → "Em todos os sites", e recarregue o Zoho.';
                line.classList.add('field-history-error');
                box.classList.remove('is-hidden');
                return;
            }
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
