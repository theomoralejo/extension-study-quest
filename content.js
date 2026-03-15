// Content Script - Injeta Quick Replies no Zoho CRM
(function () {
    'use strict';

    let quickRepliesButton = null;
    let quickRepliesPanel = null;
    let currentEditor = null;

    // Inicializar quando a página carregar
    init();

    function init() {
        console.log('Zoho Quick Replies Extension: Iniciando...');

        // Observar mudanças no DOM para detectar quando o editor de notas aparece
        const observer = new MutationObserver(function (mutations) {
            checkForNoteEditor();
            checkForPhoneNumbers(); // Executar também para checar números de telefone
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Verificar inicialmente
        setTimeout(() => {
            checkForNoteEditor();
            checkForPhoneNumbers();
        }, 1000);
    }

    function checkForNoteEditor() {
        // Procurar pelo editor de notas do Zoho
        const noteEditors = document.querySelectorAll('crux-note-editor');

        noteEditors.forEach(editor => {
            // Verificar se já adicionamos o botão neste editor
            if (editor.dataset.quickRepliesAdded) {
                return;
            }

            // Procurar pela área de ferramentas do editor
            const footerLeft = editor.querySelector('.cxNotesFooterLeft');

            if (footerLeft && !editor.dataset.quickRepliesAdded) {
                addQuickRepliesButton(footerLeft, editor);
                editor.dataset.quickRepliesAdded = 'true';
                console.log('Zoho Quick Replies: Botão adicionado ao editor');
            }
        });
    }

    function addQuickRepliesButton(footerLeft, editor) {
        // Criar botão de Quick Replies
        const button = document.createElement('span');
        button.className = 'quick-replies-btn cxNotesFooterIcoWrap';
        const btnIconUrl = chrome.runtime.getURL('icons/icon16.png');
        button.innerHTML = `
            <img src="${btnIconUrl}" class="quick-replies-icon" style="width: 16px; height: 16px; display: block;" alt="SQ">
        `;
        button.title = 'Quick Replies';
        button.style.cursor = 'pointer';
        button.style.marginRight = '8px';

        // Adicionar evento de clique
        button.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            currentEditor = editor;
            toggleQuickRepliesPanel(button);
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
        // Criar painel
        const panel = document.createElement('div');
        panel.className = 'quick-replies-panel';
        const iconUrl = chrome.runtime.getURL('icons/icon16.png');
        panel.innerHTML = `
            <div class="quick-replies-header">
                <span class="quick-replies-title" style="display: flex; align-items: center; gap: 8px;">
                    <img src="${iconUrl}" style="width: 16px; height: 16px; display: block;" alt="SQ"> 
                    Study Quest Replies
                </span>
                <button class="quick-replies-close">✕</button>
            </div>
            <div class="quick-replies-search" style="display: flex; gap: 8px;">
                <input type="text" placeholder="Buscar respostas..." class="quick-replies-search-input" style="flex: 2;">
                <select id="quickRepliesCategoryFilter" style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
                    <option value="">Categorias</option>
                </select>
            </div>
            <div class="quick-replies-list" id="quickRepliesList">
                <div class="quick-replies-loading">Carregando...</div>
            </div>
        `;

        // Posicionar o painel
        const rect = button.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = (rect.bottom + 5) + 'px';
        panel.style.left = rect.left + 'px';

        document.body.appendChild(panel);
        quickRepliesPanel = panel;

        // Adicionar eventos
        panel.querySelector('.quick-replies-close').addEventListener('click', closeQuickRepliesPanel);
        panel.querySelector('.quick-replies-search-input').addEventListener('input', handleSearch);
        panel.querySelector('#quickRepliesCategoryFilter').addEventListener('change', handleSearch);

        // Carregar respostas
        loadQuickReplies();

        // Fechar ao clicar fora
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 100);
    }

    function closeQuickRepliesPanel() {
        if (quickRepliesPanel && quickRepliesPanel.parentNode) {
            quickRepliesPanel.remove();
            quickRepliesPanel = null;
            document.removeEventListener('click', handleOutsideClick);
        }
    }

    function handleOutsideClick(e) {
        if (quickRepliesPanel && !quickRepliesPanel.contains(e.target)) {
            const quickRepliesBtn = document.querySelector('.quick-replies-btn');
            if (!quickRepliesBtn || !quickRepliesBtn.contains(e.target)) {
                closeQuickRepliesPanel();
            }
        }
    }

    // Obter usuário da DOM do Zoho (Se não encontrar, manda null ou '')
    function getZohoAuthor() {
        const usernameElem = document.querySelector('a.profile_username span, .user-name, #userName');
        if (usernameElem) {
            return usernameElem.textContent.trim();
        }
        return '';
    }

    function loadQuickReplies(searchTerm = '', categoryFilter = '') {
        fetch('https://cv.studyquestuk.com/api/replies', {
            headers: { 'x-api-key': 'sq-54321-secret-key' }
        })
            .then(res => res.json())
            .then(replies => {
                displayQuickReplies(replies || [], searchTerm, categoryFilter);
            })
            .catch(err => {
                console.error('Erro ao buscar respostas do backend:', err);
                displayQuickReplies([], searchTerm, categoryFilter);
            });
    }

    function displayQuickReplies(replies, searchTerm = '', categoryFilter = '') {
        const listContainer = document.getElementById('quickRepliesList');

        if (!listContainer) return;

        let filteredReplies = replies;

        if (categoryFilter && categoryFilter !== '') {
            filteredReplies = filteredReplies.filter(r => r.category === categoryFilter);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredReplies = filteredReplies.filter(reply =>
                reply.title.toLowerCase().includes(term) ||
                reply.text.toLowerCase().includes(term) ||
                (reply.category && reply.category.toLowerCase().includes(term))
            );
        }

        if (filteredReplies.length === 0) {
            listContainer.innerHTML = `
                <div class="quick-replies-empty">
                    ${searchTerm ? 'Nenhuma resposta encontrada' : 'Nenhuma resposta cadastrada'}
                </div>
            `;
            return;
        }

        // Extrair categorias para o select
        const categories = [...new Set(replies.map(r => r.category || 'Geral'))].sort();
        const selectElem = document.getElementById('quickRepliesCategoryFilter');
        if (selectElem && selectElem.options.length <= 1) {
            categories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                selectElem.appendChild(opt);
            });
        }

        listContainer.innerHTML = filteredReplies.map(reply => `
            <div class="quick-reply-item" data-id="${reply.id}">
                <div class="quick-reply-title">
                    ${escapeHtml(reply.title)}
                    <span style="font-size: 10px; background: #eee; padding: 2px 4px; border-radius: 4px; color: #555; margin-left: 4px;">
                        ${escapeHtml(reply.category || 'Geral')}
                    </span>
                </div>
                <div class="quick-reply-text">${escapeHtml(reply.text)}</div>
                <div style="font-size: 10px; color: #888; margin-top: 4px;">Por: ${escapeHtml(reply.author || 'User')}</div>
            </div>
        `).join('');

        listContainer.querySelectorAll('.quick-reply-item').forEach(item => {
            item.addEventListener('click', function () {
                const id = this.dataset.id;
                const reply = filteredReplies.find(r => r.id === id);
                if (reply) {
                    insertReplyIntoEditor(reply.title, reply.text);
                }
            });
        });
    }

    function handleSearch() {
        if (!quickRepliesPanel) return;
        const searchTerm = quickRepliesPanel.querySelector('.quick-replies-search-input').value;
        const categoryFilter = quickRepliesPanel.querySelector('#quickRepliesCategoryFilter').value;
        loadQuickReplies(searchTerm, categoryFilter);
    }

    function insertReplyIntoEditor(title, text) {
        if (!currentEditor) return;

        // Preenche o campo de título da nota
        const titleInput = currentEditor.querySelector('input.cxNoteTitleInputElem');
        if (titleInput) {
            titleInput.value = title;
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Preenche o corpo da nota
        const bodyEditor = currentEditor.querySelector('.lyteEditorMainDiv');

        if (!bodyEditor) {
            showNotification('Abra o editor de nota antes de inserir.', 'error');
            return;
        }

        const editable = bodyEditor.getAttribute('contenteditable')
            ? bodyEditor
            : (bodyEditor.querySelector('[contenteditable="true"]') || bodyEditor);

        editable.focus();

        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        document.execCommand('insertText', false, text);

        closeQuickRepliesPanel();
        showNotification('Texto inserido com sucesso!');
    }

    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `quick-replies-notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- Nova Funcionalidade de WhatsApp ---

    function checkForPhoneNumbers() {
        // Find crux-phone-component and elements with call icons
        const phoneComponents = document.querySelectorAll('crux-phone-component:not([data-wa-added])');
        const callContainers = document.querySelectorAll('crmutil-icon[icon-name^="call"]:not([data-wa-added])');

        // Handle crux-phone-component
        phoneComponents.forEach(comp => {
            const phoneSpan = comp.querySelector('.lvPhFld');
            let phone = '';
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

        // Handle basic divs with call icons
        callContainers.forEach(icon => {
            const parent = icon.parentElement;
            if (parent && parent.textContent) {
                const text = parent.textContent.trim();
                // Extract clean phone removing everything except digits and plus sign
                const cleanPhone = text.replace(/[^\d+]/g, '');
                if (cleanPhone.length > 5) {
                    injectWhatsAppButton(parent, cleanPhone);
                    icon.dataset.waAdded = 'true';
                }
            }
        });
    }

    function injectWhatsAppButton(container, phoneNumber) {
        // Clean the phone number (remove spaces, letters, etc., keep only digits and +)
        const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');

        // Generate WhatsApp link (remove + at the beginning for wa.me)
        const finalPhoneForLink = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;
        const waLink = `https://wa.me/${finalPhoneForLink}`;

        // Create the WhatsApp Button
        const waBtn = document.createElement('a');
        waBtn.href = waLink;
        waBtn.target = '_blank';
        waBtn.className = 'zoho-wa-btn';
        waBtn.title = 'Abrir no WhatsApp';
        waBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

        waBtn.style.display = 'inline-flex';
        waBtn.style.alignItems = 'center';
        waBtn.style.justifyContent = 'center';
        waBtn.style.marginLeft = '8px';
        waBtn.style.cursor = 'pointer';
        waBtn.style.textDecoration = 'none';
        waBtn.style.verticalAlign = 'middle';
        waBtn.style.transition = 'transform 0.2s';

        waBtn.addEventListener('mouseenter', () => waBtn.style.transform = 'scale(1.1)');
        waBtn.addEventListener('mouseleave', () => waBtn.style.transform = 'scale(1)');

        // Prevent event from bubbling up to the inline edit trigger
        const preventEdit = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        const interceptEvents = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'dragstart', 'touchstart', 'touchend'];
        interceptEvents.forEach(evt => {
            waBtn.addEventListener(evt, (e) => {
                e.stopPropagation();
            });
            waBtn.addEventListener(evt, (e) => {
                e.stopPropagation();
            }, true);
        });

        // Permitir que o link abra a aba manualmente no click, pois cancelamos a propagação
        waBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.open(waLink, '_blank');
        });

        // Container-specific positioning
        let labelElem = null;
        let curr = container;
        for (let i = 0; i < 6; i++) {
            if (!curr || curr === document.body) break;
            const parent = curr.parentElement;
            if (!parent) break;

            // Search before curr for labels
            let prev = curr.previousElementSibling;
            while (prev) {
                if (prev.tagName === 'TH' || prev.tagName === 'LABEL' || (typeof prev.className === 'string' && prev.className.match(/label|tit/i)) || prev.tagName.match(/label/i)) {
                    labelElem = prev;
                    break;
                }
                const inner = prev.querySelector('label, [class*="label"], [class*="Label"]');
                if (inner) {
                    labelElem = inner;
                    break;
                }
                prev = prev.previousElementSibling;
            }
            if (labelElem) break;

            const labels = parent.querySelectorAll('label, th, [class*="label"], [class*="Label"]');
            for (let j = 0; j < labels.length; j++) {
                if (!labels[j].contains(container)) {
                    labelElem = labels[j];
                    break;
                }
            }
            if (labelElem) break;

            if (parent.tagName === 'TR') {
                const headCell = parent.querySelector('th, td.label-cell, td[class*="Label"]');
                if (headCell) {
                    labelElem = headCell;
                    break;
                }
            }
            curr = parent;
        }

        if (labelElem) {
            // Find inner-most text container wrapper to avoid breaking layouts
            const textContainer = labelElem.querySelector('span:not(.zoho-wa-btn), div:not(.zoho-wa-btn), b, strong') || labelElem;

            waBtn.style.margin = '0 6px 0 0';
            waBtn.style.display = 'inline-block';
            waBtn.style.verticalAlign = 'middle';

            // Just insert without changing container layout
            textContainer.insertBefore(waBtn, textContainer.firstChild);
        } else {
            // Fallback: put it far to the left of the component outer box
            waBtn.style.margin = '0 6px 0 0';
            waBtn.style.display = 'inline-block';
            waBtn.style.verticalAlign = 'middle';

            let injectionTarget = container;
            if (container.tagName.toLowerCase() === 'crux-phone-component') {
                const zpbWrap = container.closest('span[class*="phoneRtlA"]');
                if (zpbWrap && zpbWrap.parentElement) {
                    injectionTarget = zpbWrap.parentElement;
                } else {
                    const viewWrap = container.querySelector('.cxPhoneViewZPBEnabledIconWrap') || container.querySelector('.cxPhoneViewZPBEnabled');
                    if (viewWrap && viewWrap.parentElement) injectionTarget = viewWrap.parentElement;
                }
            }

            // Just insert without changing container layout
            injectionTarget.insertBefore(waBtn, injectionTarget.firstChild);
        }
    }

    // Escutar pedidos do Popup (Ex: requisição do nome do usuario logado no Zoho)
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.action === 'getAuthor') {
            const authorName = getZohoAuthor();
            sendResponse({ author: authorName });
        }
        return true;
    });

})();
