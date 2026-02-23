// Content Script - Injeta Quick Replies no Zoho CRM
(function() {
    'use strict';
    
    let quickRepliesButton = null;
    let quickRepliesPanel = null;
    let currentEditor = null;
    
    // Inicializar quando a página carregar
    init();
    
    function init() {
        console.log('Zoho Quick Replies Extension: Iniciando...');
        
        // Observar mudanças no DOM para detectar quando o editor de notas aparece
        const observer = new MutationObserver(function(mutations) {
            checkForNoteEditor();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Verificar inicialmente
        setTimeout(checkForNoteEditor, 1000);
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
        button.innerHTML = `
            <i class="quick-replies-icon">⚡</i>
        `;
        button.title = 'Quick Replies';
        button.style.cursor = 'pointer';
        button.style.marginRight = '8px';
        
        // Adicionar evento de clique
        button.addEventListener('click', function(e) {
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
        panel.innerHTML = `
            <div class="quick-replies-header">
                <span class="quick-replies-title">⚡ Quick Replies</span>
                <button class="quick-replies-close">✕</button>
            </div>
            <div class="quick-replies-search">
                <input type="text" placeholder="Buscar respostas rápidas..." class="quick-replies-search-input">
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
    
    function loadQuickReplies(searchTerm = '') {
        chrome.storage.sync.get(['quickReplies'], function(result) {
            const replies = result.quickReplies || [];
            displayQuickReplies(replies, searchTerm);
        });
    }
    
    function displayQuickReplies(replies, searchTerm = '') {
        const listContainer = document.getElementById('quickRepliesList');

        if (!listContainer) return;

        let filteredReplies = replies;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredReplies = replies.filter(reply =>
                reply.title.toLowerCase().includes(term) ||
                reply.text.toLowerCase().includes(term)
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

        listContainer.innerHTML = filteredReplies.map(reply => `
            <div class="quick-reply-item" data-id="${reply.id}">
                <div class="quick-reply-title">${escapeHtml(reply.title)}</div>
                <div class="quick-reply-text">${escapeHtml(reply.text)}</div>
            </div>
        `).join('');

        listContainer.querySelectorAll('.quick-reply-item').forEach(item => {
            item.addEventListener('click', function() {
                const id = this.dataset.id;
                const reply = filteredReplies.find(r => r.id === id);
                if (reply) {
                    insertReplyIntoEditor(reply.title, reply.text);
                }
            });
        });
    }
    
    function handleSearch(e) {
        const searchTerm = e.target.value;
        loadQuickReplies(searchTerm);
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
    
})();
