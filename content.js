// Content Script - Injeta Quick Replies no Zoho CRM
(function () {
    'use strict';

    var SQ = globalThis.SQBrowser;
    var CFG = globalThis.SQConfig;

    var quickRepliesPanel = null;
    var currentEditor = null;
    var panelAnchorButton = null;
    var observerTimeout = null;
    var repositionScheduled = false;

    // Espaco minimo entre o painel e a borda da janela.
    var VIEWPORT_MARGIN = 12;

    /**
     * Cria um <svg> por DOM em vez de innerHTML.
     * SVG vive no namespace XML proprio, entao `createElement` produziria um
     * elemento HTML invalido que nao renderiza — daí o createElementNS.
     */
    function makeSvg(pathData, size, fill) {
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('fill', fill);
        svg.setAttribute('aria-hidden', 'true');

        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        return svg;
    }

    var ICON_WHATSAPP = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';
    var ICON_CLIPBOARD = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';
    var ICON_CHECK = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';

    init();

    function init() {
        console.log('Study Quest Replies: iniciando...');

        // Observar mudanças no DOM usando uma versão debounced (evita travar o navegador)
        var observer = new MutationObserver(function () {
            // Em vez de processar TUDO a cada mutação, espera o DOM acalmar 300ms
            if (observerTimeout) clearTimeout(observerTimeout);

            observerTimeout = setTimeout(function () {
                checkForNoteEditor();
                checkForPhoneNumbers();
                checkForInputs();
            }, 300);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Verificar inicialmente
        setTimeout(function () {
            checkForNoteEditor();
            checkForPhoneNumbers();
            checkForInputs();

            // Buscar na inicialização e setar a flag
            cacheZohoAuthorName();
        }, 2000);

        // Executar uma rotina bem mais leve a cada 30 segundos (isso evita freezing contínuo)
        setInterval(cacheZohoAuthorName, 30000);

        // O painel e `position: fixed` ancorado no botao: se a janela muda de
        // tamanho ou a pagina rola, a ancora se move e o painel precisa
        // reacompanhar, senao ele "descola" e pode sair da tela.
        window.addEventListener('resize', scheduleReposition, { passive: true });
        window.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });
    }

    function cacheZohoAuthorName() {
        // Para nao travar a UI, executa em uma micro-tarefa nativa do EventLoop
        Promise.resolve().then(function () {
            var author = getZohoAuthor();
            if (author && SQ) {
                SQ.storageSet({ zohoAuthor: author });
            }
        });
    }

    function checkForNoteEditor() {
        // Procurar pelo editor de notas do Zoho
        var noteEditors = document.querySelectorAll('crux-note-editor');

        noteEditors.forEach(function (editor) {
            // Verificar se já adicionamos o botão neste editor
            if (editor.dataset.quickRepliesAdded) {
                return;
            }

            // Procurar pela área de ferramentas do editor
            var footerLeft = editor.querySelector('.cxNotesFooterLeft');

            if (footerLeft) {
                addQuickRepliesButton(footerLeft, editor);
                editor.dataset.quickRepliesAdded = 'true';
                console.log('Study Quest Replies: botão adicionado ao editor');
            }
        });
    }

    function addQuickRepliesButton(footerLeft, editor) {
        // Criar botão de Quick Replies
        var button = document.createElement('span');
        button.className = 'quick-replies-btn cxNotesFooterIcoWrap';
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');

        var img = document.createElement('img');
        img.src = SQ.getURL('icons/icon16.png');
        img.className = 'quick-replies-icon';
        img.alt = 'Study Quest';
        img.style.width = '16px';
        img.style.height = '16px';
        img.style.display = 'block';
        button.appendChild(img);

        button.title = 'Quick Replies';
        button.style.cursor = 'pointer';
        button.style.marginRight = '8px';

        function activate(e) {
            e.preventDefault();
            e.stopPropagation();
            currentEditor = editor;
            toggleQuickRepliesPanel(button);
        }

        button.addEventListener('click', activate);
        button.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') activate(e);
        });

        // Inserir o botão no início do footerLeft
        footerLeft.insertBefore(button, footerLeft.firstChild);
    }

    function toggleQuickRepliesPanel(button) {
        if (quickRepliesPanel && quickRepliesPanel.parentNode) {
            closeQuickRepliesPanel();
        } else {
            openQuickRepliesPanel(button);
        }
    }

    function openQuickRepliesPanel(button) {
        var panel = document.createElement('div');
        panel.className = 'quick-replies-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Study Quest Replies');

        // Cabecalho
        var header = document.createElement('div');
        header.className = 'quick-replies-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'quick-replies-title';
        var logo = document.createElement('img');
        logo.src = SQ.getURL('icons/icon16.png');
        logo.alt = '';
        titleSpan.appendChild(logo);
        titleSpan.appendChild(document.createTextNode('Study Quest Replies'));

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'quick-replies-close';
        closeBtn.setAttribute('aria-label', 'Fechar');
        closeBtn.textContent = '✕';

        header.appendChild(titleSpan);
        header.appendChild(closeBtn);

        // Busca + filtro
        var searchWrap = document.createElement('div');
        searchWrap.className = 'quick-replies-search';

        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'quickRepliesSearch';
        searchInput.name = 'quickRepliesSearch';
        searchInput.autocomplete = 'off';
        searchInput.placeholder = 'Buscar respostas...';
        searchInput.className = 'quick-replies-search-input';
        searchInput.setAttribute('aria-label', 'Buscar respostas');

        var categoryFilter = document.createElement('select');
        categoryFilter.id = 'quickRepliesCategoryFilter';
        categoryFilter.name = 'quickRepliesCategoryFilter';
        categoryFilter.className = 'quick-replies-category-filter';
        categoryFilter.setAttribute('aria-label', 'Filtrar por categoria');
        var allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'Categorias';
        categoryFilter.appendChild(allOpt);

        searchWrap.appendChild(searchInput);
        searchWrap.appendChild(categoryFilter);

        // Lista
        var list = document.createElement('div');
        list.className = 'quick-replies-list';
        list.id = 'quickRepliesList';
        var loading = document.createElement('div');
        loading.className = 'quick-replies-loading';
        loading.textContent = 'Carregando...';
        list.appendChild(loading);

        panel.appendChild(header);
        panel.appendChild(searchWrap);
        panel.appendChild(list);

        document.body.appendChild(panel);
        quickRepliesPanel = panel;
        panelAnchorButton = button;
        button.setAttribute('aria-expanded', 'true');

        positionPanel();

        panel.querySelector('.quick-replies-close').addEventListener('click', closeQuickRepliesPanel);
        panel.querySelector('.quick-replies-search-input').addEventListener('input', handleSearch);
        panel.querySelector('#quickRepliesCategoryFilter').addEventListener('change', handleSearch);

        loadQuickReplies();

        // Fechar ao clicar fora
        setTimeout(function () {
            document.addEventListener('click', handleOutsideClick);
            document.addEventListener('keydown', handleEscape);
        }, 100);
    }

    /**
     * Ancora o painel no botao e o mantem dentro da viewport.
     *
     * Antes o painel era posicionado direto em (rect.left, rect.bottom): com o
     * botao perto da borda direita ou inferior — comum com o CRM em tela
     * dividida ou janela estreita — parte dele ficava fora da tela e sem como
     * ser alcancada. Aqui a posicao e limitada as bordas e, quando nao ha
     * espaco abaixo, o painel abre para cima.
     */
    function positionPanel() {
        if (!quickRepliesPanel || !panelAnchorButton) return;

        var anchor = panelAnchorButton.getBoundingClientRect();
        var panelRect = quickRepliesPanel.getBoundingClientRect();
        var panelWidth = panelRect.width;
        var panelHeight = panelRect.height;

        var viewportWidth = document.documentElement.clientWidth;
        var viewportHeight = document.documentElement.clientHeight;

        // Horizontal: alinha pela esquerda do botao, mas nunca ultrapassa as bordas.
        var maxLeft = viewportWidth - panelWidth - VIEWPORT_MARGIN;
        var left = Math.min(anchor.left, Math.max(VIEWPORT_MARGIN, maxLeft));
        left = Math.max(VIEWPORT_MARGIN, left);

        // Vertical: abaixo do botao por padrao; acima se nao couber e couber melhor la.
        var spaceBelow = viewportHeight - anchor.bottom - VIEWPORT_MARGIN;
        var spaceAbove = anchor.top - VIEWPORT_MARGIN;
        var top;

        if (panelHeight <= spaceBelow || spaceBelow >= spaceAbove) {
            top = anchor.bottom + 5;
        } else {
            top = anchor.top - panelHeight - 5;
        }

        var maxTop = viewportHeight - panelHeight - VIEWPORT_MARGIN;
        top = Math.min(top, Math.max(VIEWPORT_MARGIN, maxTop));
        top = Math.max(VIEWPORT_MARGIN, top);

        quickRepliesPanel.style.left = left + 'px';
        quickRepliesPanel.style.top = top + 'px';
    }

    // Agrupa resize/scroll num unico recalculo por frame.
    function scheduleReposition() {
        if (!quickRepliesPanel || repositionScheduled) return;
        repositionScheduled = true;
        requestAnimationFrame(function () {
            repositionScheduled = false;
            positionPanel();
        });
    }

    function closeQuickRepliesPanel() {
        if (quickRepliesPanel && quickRepliesPanel.parentNode) {
            quickRepliesPanel.remove();
        }
        if (panelAnchorButton) {
            panelAnchorButton.setAttribute('aria-expanded', 'false');
        }
        quickRepliesPanel = null;
        panelAnchorButton = null;
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('keydown', handleEscape);
    }

    function handleEscape(e) {
        if (e.key === 'Escape') closeQuickRepliesPanel();
    }

    function handleOutsideClick(e) {
        if (quickRepliesPanel && !quickRepliesPanel.contains(e.target)) {
            if (!panelAnchorButton || !panelAnchorButton.contains(e.target)) {
                closeQuickRepliesPanel();
            }
        }
    }

    // Tentar localizar um nome no cache da extensao primeiro
    // Se nao, procura ativamente por elementos no DOM
    function getZohoAuthor() {
        try {
            var selectors = [
                '#show-user-name',
                '#userName',
                '.user-name',
                '[data-zcqa="user_profile_name"]',
                '.profile-name',
                '#top-band-profile-name',
                'a.profile_username span',
                '#profile_name',
                '#topBand_user_name',
                '.cp-setup-user-name',
                '.usr-name',
                '.user-profile-name',
                '#zcdropdown1_text' // Selector específico às vezes usado no Header
            ];

            for (var i = 0; i < selectors.length; i++) {
                var elem = document.querySelector(selectors[i]);
                if (elem && elem.textContent && elem.textContent.trim().length > 0) {
                    return elem.textContent.trim();
                }
            }

            // As vezes está dentro do texto alternativo ou título das fotos (não a genérica)
            var userImg = document.querySelector('#crm-setup-userpic, #topBand_user_icon_img, .profile-pic img, img[alt*="Profile"]');
            if (userImg) {
                var alt = userImg.getAttribute('alt');
                if (alt && alt.trim().length > 0 && alt.toLowerCase().indexOf('profile') === -1) {
                    return alt.trim();
                }
                var title = userImg.getAttribute('title');
                if (title && title.trim().length > 0 && title.toLowerCase().indexOf('profile') === -1) {
                    return title.trim();
                }
            }

            // Opcional limitador do class pattern (pesado). Reduzido para testar só primeiros 10 pra n travar.
            var wildcardElems = document.querySelectorAll('span[class*="profile"], div[class*="profile"]');
            var maxChecks = Math.min(wildcardElems.length, 10);
            for (var j = 0; j < maxChecks; j++) {
                var el = wildcardElems[j];
                if (el && el.textContent) {
                    var txt = el.textContent.trim();
                    if (txt.length > 2 && txt.length < 30 && txt.toLowerCase().indexOf('profile') === -1 && txt.toLowerCase().indexOf('setting') === -1) {
                        return txt;
                    }
                }
            }

            return '';
        } catch (e) {
            console.error('Study Quest Replies: erro ao ler o autor', e);
            return '';
        }
    }

    function loadQuickReplies(searchTerm, categoryFilter) {
        searchTerm = searchTerm || '';
        categoryFilter = categoryFilter || '';

        fetch(CFG.url('/replies'), { headers: CFG.headers(false) })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (replies) {
                displayQuickReplies(replies || [], searchTerm, categoryFilter);
            })
            .catch(function (err) {
                console.error('Study Quest Replies: erro ao buscar respostas', err);
                showListError(describeFetchError(err));
            });
    }

    /** Traduz a falha em causa + acao, em vez de um "erro" generico. */
    function describeFetchError(err) {
        var msg = (err && err.message) || '';
        if (msg.indexOf('HTTP 401') === 0 || msg.indexOf('HTTP 403') === 0) {
            return 'Sem autorização para ler as respostas (a chave da API foi recusada). Avise o suporte.';
        }
        if (msg.indexOf('HTTP 5') === 0) {
            return 'O servidor de respostas falhou (' + msg + '). Tente de novo em alguns minutos.';
        }
        if (msg.indexOf('HTTP') === 0) {
            return 'O servidor respondeu ' + msg + '. Tente recarregar a página do CRM.';
        }
        // "Failed to fetch" / "NetworkError" e o que o browser devolve quando
        // o CORS barra a chamada — inclusive quando a API responde redirect no
        // preflight. Nao ha detalhe no objeto de erro, entao a mensagem aponta
        // onde olhar em vez de dizer so "falha de rede".
        return 'Não foi possível falar com o servidor de respostas (' +
            (msg || 'falha de rede') + '). Confira a conexão; se persistir, veja se ' +
            CFG.API_BASE + ' responde sem redirecionar (redirect quebra o CORS da extensão).';
    }

    function showListError(message) {
        var listContainer = document.getElementById('quickRepliesList');
        if (!listContainer) return;
        listContainer.textContent = '';
        var div = document.createElement('div');
        div.className = 'quick-replies-empty';
        div.textContent = message;
        listContainer.appendChild(div);
    }

    function displayQuickReplies(replies, searchTerm, categoryFilter) {
        var listContainer = document.getElementById('quickRepliesList');
        if (!listContainer) return;

        var filteredReplies = replies;

        if (categoryFilter) {
            filteredReplies = filteredReplies.filter(function (r) {
                return r.category === categoryFilter;
            });
        }

        if (searchTerm) {
            var term = searchTerm.toLowerCase();
            filteredReplies = filteredReplies.filter(function (reply) {
                return (reply.title || '').toLowerCase().indexOf(term) !== -1 ||
                    (reply.text || '').toLowerCase().indexOf(term) !== -1 ||
                    (reply.category || '').toLowerCase().indexOf(term) !== -1;
            });
        }

        // Popular o filtro de categorias a partir da lista completa (nao da filtrada),
        // senao filtrar por uma categoria apagaria as outras opcoes do select.
        var selectElem = document.getElementById('quickRepliesCategoryFilter');
        if (selectElem && selectElem.options.length <= 1) {
            var categories = [];
            replies.forEach(function (r) {
                var c = r.category || 'Geral';
                if (categories.indexOf(c) === -1) categories.push(c);
            });
            categories.sort().forEach(function (cat) {
                var opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                selectElem.appendChild(opt);
            });
        }

        listContainer.textContent = '';

        if (filteredReplies.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'quick-replies-empty';
            empty.textContent = searchTerm || categoryFilter
                ? 'Nenhuma resposta encontrada para esse filtro'
                : 'Nenhuma resposta cadastrada';
            listContainer.appendChild(empty);
            scheduleReposition();
            return;
        }

        filteredReplies.forEach(function (reply) {
            var item = document.createElement('div');
            item.className = 'quick-reply-item';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');

            var title = document.createElement('div');
            title.className = 'quick-reply-title';
            title.appendChild(document.createTextNode(reply.title || ''));

            var badge = document.createElement('span');
            badge.className = 'quick-reply-badge';
            badge.textContent = reply.category || 'Geral';
            title.appendChild(badge);

            var text = document.createElement('div');
            text.className = 'quick-reply-text';
            text.textContent = reply.text || '';

            var author = document.createElement('div');
            author.className = 'quick-reply-author';
            author.textContent = 'Por: ' + (reply.author || 'User');

            item.appendChild(title);
            item.appendChild(text);
            item.appendChild(author);

            function insert() {
                insertReplyIntoEditor(reply.title, reply.text);
            }
            item.addEventListener('click', insert);
            item.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    insert();
                }
            });

            listContainer.appendChild(item);
        });

        // A altura mudou: reancorar para o painel nao vazar pela borda de baixo.
        scheduleReposition();
    }

    function handleSearch() {
        if (!quickRepliesPanel) return;
        var searchTerm = quickRepliesPanel.querySelector('.quick-replies-search-input').value;
        var categoryFilter = quickRepliesPanel.querySelector('#quickRepliesCategoryFilter').value;
        loadQuickReplies(searchTerm, categoryFilter);
    }

    function insertReplyIntoEditor(title, text) {
        if (!currentEditor) return;

        // Preenche o campo de título da nota
        var titleInput = currentEditor.querySelector('input.cxNoteTitleInputElem');
        if (titleInput) {
            titleInput.value = title;
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Preenche o corpo da nota
        var bodyEditor = currentEditor.querySelector('.lyteEditorMainDiv');

        if (!bodyEditor) {
            showNotification('Abra o editor de nota antes de inserir.', 'error');
            return;
        }

        var editable = bodyEditor.getAttribute('contenteditable')
            ? bodyEditor
            : (bodyEditor.querySelector('[contenteditable="true"]') || bodyEditor);

        editable.focus();

        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        if (!insertTextAtCaret(editable, text)) {
            showNotification('Não foi possível inserir o texto no editor do CRM. Copie manualmente.', 'error');
            return;
        }

        closeQuickRepliesPanel();
        showNotification('Texto inserido com sucesso!');
    }

    /**
     * Insere texto no cursor de um contenteditable.
     *
     * `execCommand` e obsoleto e cada navegador o trata de um jeito, entao ele
     * e apenas a primeira tentativa; se falhar ou nao alterar nada, o texto e
     * inserido pela Selection API, que e o caminho padronizado. O `input`
     * sintetico no fim e o que faz o editor do Zoho perceber a mudanca.
     */
    function insertTextAtCaret(editable, text) {
        var before = editable.textContent;

        try {
            if (document.execCommand && document.execCommand('insertText', false, text)) {
                if (editable.textContent !== before) return true;
            }
        } catch (e) {
            // Segue para o caminho padronizado abaixo.
        }

        try {
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return false;

            var range = sel.getRangeAt(0);
            range.deleteContents();

            // Preservar quebras de linha: o texto vem de um textarea.
            var fragment = document.createDocumentFragment();
            var lines = String(text).split('\n');
            lines.forEach(function (line, i) {
                if (i > 0) fragment.appendChild(document.createElement('br'));
                fragment.appendChild(document.createTextNode(line));
            });

            var lastNode = fragment.lastChild;
            range.insertNode(fragment);

            if (lastNode) {
                range.setStartAfter(lastNode);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }

            editable.dispatchEvent(new Event('input', { bubbles: true }));
            return editable.textContent !== before;
        } catch (e) {
            console.error('Study Quest Replies: falha ao inserir texto', e);
            return false;
        }
    }

    function showNotification(message, type) {
        var notification = document.createElement('div');
        notification.className = 'quick-replies-notification ' + (type || 'success');
        notification.setAttribute('role', 'status');
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(function () {
            notification.classList.add('show');
        }, 10);

        setTimeout(function () {
            notification.classList.remove('show');
            setTimeout(function () { notification.remove(); }, 300);
        }, 2000);
    }

    // --- Funcionalidade de WhatsApp ---

    function checkForPhoneNumbers() {
        var phoneComponents = document.querySelectorAll('crux-phone-component:not([data-wa-added])');
        var callContainers = document.querySelectorAll('crmutil-icon[icon-name^="call"]:not([data-wa-added])');

        phoneComponents.forEach(function (comp) {
            var phoneSpan = comp.querySelector('.lvPhFld');
            var phone = '';
            if (phoneSpan) {
                phone = phoneSpan.textContent.trim();
            } else {
                phone = comp.getAttribute('cx-prop-value') || '';
            }

            if (phone && phone !== 'undefined' && phone !== 'null') {
                injectWhatsAppButton(comp, phone);
                comp.dataset.waAdded = 'true';
            }
        });

        callContainers.forEach(function (icon) {
            var parent = icon.parentElement;
            if (parent && parent.textContent) {
                var text = parent.textContent.trim();
                var cleanPhone = text.replace(/[^\d+]/g, '');
                if (cleanPhone.length > 5) {
                    injectWhatsAppButton(parent, cleanPhone);
                    icon.dataset.waAdded = 'true';
                }
            }
        });
    }

    function injectWhatsAppButton(container, phoneNumber) {
        var cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
        var finalPhoneForLink = cleanPhone.charAt(0) === '+' ? cleanPhone.substring(1) : cleanPhone;
        var waLink = 'https://wa.me/' + finalPhoneForLink;

        var waBtn = document.createElement('a');
        waBtn.href = waLink;
        waBtn.target = '_blank';
        waBtn.rel = 'noopener noreferrer';
        waBtn.className = 'zoho-wa-btn';
        waBtn.title = 'Abrir no WhatsApp';
        waBtn.setAttribute('aria-label', 'Abrir ' + cleanPhone + ' no WhatsApp');
        waBtn.appendChild(makeSvg(ICON_WHATSAPP, 18, '#25D366'));

        waBtn.style.display = 'inline-flex';
        waBtn.style.alignItems = 'center';
        waBtn.style.justifyContent = 'center';
        waBtn.style.marginLeft = '8px';
        waBtn.style.cursor = 'pointer';
        waBtn.style.textDecoration = 'none';
        waBtn.style.verticalAlign = 'middle';
        waBtn.style.transition = 'transform 0.2s';

        waBtn.addEventListener('mouseenter', function () { waBtn.style.transform = 'scale(1.1)'; });
        waBtn.addEventListener('mouseleave', function () { waBtn.style.transform = 'scale(1)'; });

        // Impede que o clique suba e abra a edicao inline do Zoho.
        var interceptEvents = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'dragstart', 'touchstart', 'touchend'];
        interceptEvents.forEach(function (evt) {
            waBtn.addEventListener(evt, function (e) { e.stopPropagation(); });
            waBtn.addEventListener(evt, function (e) { e.stopPropagation(); }, true);
        });

        // Como cancelamos a propagacao, abrimos a aba manualmente.
        waBtn.addEventListener('click', function (e) {
            e.preventDefault();
            window.open(waLink, '_blank', 'noopener');
        });

        // Container-specific positioning
        var labelElem = null;
        var curr = container;
        for (var i = 0; i < 6; i++) {
            if (!curr || curr === document.body) break;
            var parent = curr.parentElement;
            if (!parent) break;

            var prev = curr.previousElementSibling;
            while (prev) {
                if (prev.tagName === 'TH' || prev.tagName === 'LABEL' || (typeof prev.className === 'string' && prev.className.match(/label|tit/i))) {
                    labelElem = prev;
                    break;
                }
                var inner = prev.querySelector('label, [class*="label"], [class*="Label"]');
                if (inner) {
                    labelElem = inner;
                    break;
                }
                prev = prev.previousElementSibling;
            }
            if (labelElem) break;

            var labels = parent.querySelectorAll('label, th, [class*="label"], [class*="Label"]');
            for (var j = 0; j < labels.length; j++) {
                if (!labels[j].contains(container)) {
                    labelElem = labels[j];
                    break;
                }
            }
            if (labelElem) break;

            if (parent.tagName === 'TR') {
                var headCell = parent.querySelector('th, td.label-cell, td[class*="Label"]');
                if (headCell) {
                    labelElem = headCell;
                    break;
                }
            }
            curr = parent;
        }

        waBtn.style.margin = '0 6px 0 0';
        waBtn.style.display = 'inline-block';
        waBtn.style.verticalAlign = 'middle';

        if (labelElem) {
            var textContainer = labelElem.querySelector('span:not(.zoho-wa-btn), div:not(.zoho-wa-btn), b, strong') || labelElem;
            textContainer.insertBefore(waBtn, textContainer.firstChild);
        } else {
            var injectionTarget = container;
            if (container.tagName.toLowerCase() === 'crux-phone-component') {
                var zpbWrap = container.closest('span[class*="phoneRtlA"]');
                if (zpbWrap && zpbWrap.parentElement) {
                    injectionTarget = zpbWrap.parentElement;
                } else {
                    var viewWrap = container.querySelector('.cxPhoneViewZPBEnabledIconWrap') || container.querySelector('.cxPhoneViewZPBEnabled');
                    if (viewWrap && viewWrap.parentElement) injectionTarget = viewWrap.parentElement;
                }
            }
            injectionTarget.insertBefore(waBtn, injectionTarget.firstChild);
        }
    }

    // --- Botão de Copiar Texto ---

    function checkForInputs() {
        // Somente as caixas de valor finais (para nao sujar menus e labels da esquerda)
        var textComponents = document.querySelectorAll('.dv_info_value_field:not([data-copy-added])');
        var pending = [];

        textComponents.forEach(function (comp) {
            // Ignorar celulas de lista com checkbox, tags ou icones de acao (nao quebrar a tabela)
            if (comp.querySelector('crmutil-icon') ||
                comp.classList.contains('lvCheckboxCol') ||
                comp.classList.contains('lvEditIconCol') ||
                comp.classList.contains('lv_activityLink') ||
                comp.classList.contains('lv_noCustomBtn') ||
                comp.classList.contains('lv_fixedLastCol')
            ) {
                comp.dataset.copyAdded = 'true';
                return;
            }

            var valueToCopy = readFieldValue(comp);

            if (valueToCopy && valueToCopy.length >= 5000) {
                // Muito grande, ignorar para performance
                comp.dataset.copyAdded = 'true';
                return;
            }

            // Injetar SEMPRE: se a pessoa preencher o campo depois, o botao ja esta la.
            pending.push(buildCopyButton(comp));
            comp.dataset.copyAdded = 'true';
        });

        // Um unico frame para todas as insercoes do lote. Antes cada botao
        // agendava seu proprio setTimeout e mexia no layout do pai, o que
        // multiplicava reflows numa tela com dezenas de campos.
        if (pending.length) {
            requestAnimationFrame(function () {
                pending.forEach(function (task) { task(); });
            });
        }
    }

    /** Le o valor exibido de um campo do Zoho, cobrindo os formatos conhecidos. */
    function readFieldValue(container) {
        var input = container.querySelector('input[type="text"], input[type="number"], input[type="email"], textarea');
        if (input && input.value) return input.value;

        var cruxComp = container.querySelector('[cx-prop-value]');
        if (cruxComp) {
            var attr = cruxComp.getAttribute('cx-prop-value');
            if (attr && attr.trim() !== '') return attr;
        }

        var crmDetailFields = container.querySelector('crm-detailview-fields');
        if (crmDetailFields) {
            // Campo sinalizado como vazio pelo proprio Zoho
            if (crmDetailFields.querySelector('.dv_noDataSign') || crmDetailFields.classList.contains('dv_noDataSign')) {
                return '';
            }
            var tempClone = crmDetailFields.cloneNode(true);
            tempClone.querySelectorAll('dummy-port-element').forEach(function (e) { e.remove(); });
            return tempClone.textContent.trim();
        }

        return container.textContent.trim();
    }

    /** Cria o botao de copiar e devolve a funcao que o insere no DOM. */
    function buildCopyButton(container) {
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'zoho-copy-btn';
        copyBtn.title = 'Copiar conteúdo';
        copyBtn.setAttribute('aria-label', 'Copiar conteúdo do campo');

        /** Troca o icone do botao, sempre por DOM. */
        function setIcon(pathData, fill) {
            copyBtn.textContent = '';
            copyBtn.appendChild(makeSvg(pathData, 16, fill));
        }

        setIcon(ICON_CLIPBOARD, '#666');

        copyBtn.style.display = 'inline-flex';
        copyBtn.style.alignItems = 'center';
        copyBtn.style.justifyContent = 'center';
        copyBtn.style.cursor = 'pointer';
        copyBtn.style.verticalAlign = 'middle';
        copyBtn.style.transition = 'background 0.2s ease';
        copyBtn.style.padding = '2px';
        copyBtn.style.border = 'none';
        copyBtn.style.background = 'transparent';
        copyBtn.style.borderRadius = '4px';
        copyBtn.style.flexShrink = '0';
        copyBtn.style.margin = '2px 8px 0 0';

        copyBtn.addEventListener('mouseenter', function () {
            copyBtn.style.background = '#f0f0f0';
            copyBtn.querySelector('svg').style.fill = '#333';
        });
        copyBtn.addEventListener('mouseleave', function () {
            copyBtn.style.background = 'transparent';
            copyBtn.querySelector('svg').style.fill = '#666';
        });

        function showSuccess() {
            setIcon(ICON_CHECK, '#4CAF50');
            showNotification('Copiado para a área de transferência!', 'success');
            setTimeout(function () {
                setIcon(ICON_CLIPBOARD, '#666');
            }, 1500);
        }

        copyBtn.addEventListener('click', function (e) {
            e.preventDefault();

            // Reler no clique: o campo pode ter sido preenchido depois da injecao.
            var currentText = readFieldValue(container);

            if (!currentText || currentText === '--' || currentText === 'null') {
                showNotification('Campo vazio, nada para copiar', 'error');
                return;
            }

            copyText(currentText, showSuccess);
        });

        // Nao deixar o clique subir e abrir a edicao inline do Zoho.
        ['mousedown', 'mouseup', 'click'].forEach(function (evt) {
            copyBtn.addEventListener(evt, function (e) { e.stopPropagation(); }, false);
        });

        return function insert() {
            if (!container || !container.parentNode) return;
            var parent = container.parentNode;

            parent.style.display = 'flex';
            parent.style.flexDirection = 'row';
            parent.style.alignItems = 'center';

            if (parent.classList.contains('dvValueContainer') ||
                parent.classList.contains('dv_info_value') ||
                parent.classList.contains('lv_data_textfield') ||
                parent.classList.contains('lv_data_phone') ||
                parent.classList.contains('lv_data_email')) {
                // Botao FORA e ANTES da caixa de valor, para nao atropelar a edicao.
                parent.insertBefore(copyBtn, container);
            } else {
                copyBtn.style.margin = '0 6px 0 0';
                container.insertBefore(copyBtn, container.firstChild);
            }
        };
    }

    /**
     * Copia texto cobrindo os tres cenarios: a Clipboard API moderna, a recusa
     * por falta de permissao (Firefox pede `clipboardWrite`) e navegadores em
     * que ela nao existe — nesse caso cai no textarea + execCommand, que ainda
     * funciona por rodar dentro do gesto do usuario.
     */
    function copyText(text, onSuccess) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(onSuccess).catch(function (err) {
                console.warn('Study Quest Replies: clipboard API recusada, usando fallback', err);
                fallbackCopy(text, onSuccess);
            });
            return;
        }
        fallbackCopy(text, onSuccess);
    }

    function fallbackCopy(text, onSuccess) {
        var textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        document.body.appendChild(textArea);

        // Foco e selecao explicitos: o Safari ignora `select()` sozinho em iOS.
        textArea.focus();
        textArea.select();
        if (textArea.setSelectionRange) {
            textArea.setSelectionRange(0, text.length);
        }

        try {
            if (document.execCommand('copy')) {
                onSuccess();
            } else {
                showNotification('O navegador bloqueou a cópia. Selecione o texto e use Ctrl+C.', 'error');
            }
        } catch (err) {
            console.error('Study Quest Replies: erro ao copiar', err);
            showNotification('O navegador bloqueou a cópia (' + (err.message || 'motivo desconhecido') + '). Use Ctrl+C.', 'error');
        }

        document.body.removeChild(textArea);
    }

    // Escutar pedidos do Popup (ex.: nome do usuario logado no Zoho)
    SQ.onMessage(function (request) {
        if (request && request.action === 'getAuthor') {
            return { author: getZohoAuthor() };
        }
        return undefined;
    });

})();
