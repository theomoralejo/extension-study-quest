// Popup.js - Gerenciamento de Quick Replies
let editingId = null;

document.addEventListener('DOMContentLoaded', function() {
    loadReplies();
    
    document.getElementById('replyForm').addEventListener('submit', handleSubmit);
});

function handleSubmit(e) {
    e.preventDefault();
    
    const title = document.getElementById('replyTitle').value.trim();
    const text = document.getElementById('replyText').value.trim();
    
    if (!title || !text) {
        showAlert('Por favor, preencha todos os campos', 'error');
        return;
    }
    
    chrome.storage.sync.get(['quickReplies'], function(result) {
        let replies = result.quickReplies || [];
        
        if (editingId !== null) {
            // Editando resposta existente
            const index = replies.findIndex(r => r.id === editingId);
            if (index !== -1) {
                replies[index] = {
                    id: editingId,
                    title: title,
                    text: text,
                    updatedAt: new Date().toISOString()
                };
                showAlert('Resposta atualizada com sucesso!', 'success');
            }
            editingId = null;
            document.getElementById('submitBtn').textContent = 'Adicionar Resposta Rápida';
        } else {
            // Adicionando nova resposta
            const newReply = {
                id: Date.now().toString(),
                title: title,
                text: text,
                createdAt: new Date().toISOString()
            };
            replies.push(newReply);
            showAlert('Resposta adicionada com sucesso!', 'success');
        }
        
        chrome.storage.sync.set({ quickReplies: replies }, function() {
            document.getElementById('replyForm').reset();
            loadReplies();
        });
    });
}

function loadReplies() {
    chrome.storage.sync.get(['quickReplies'], function(result) {
        const replies = result.quickReplies || [];
        const listContainer = document.getElementById('repliesList');
        
        if (replies.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    Nenhuma resposta rápida cadastrada.<br>
                    Adicione sua primeira resposta acima!
                </div>
            `;
            return;
        }
        
        listContainer.innerHTML = replies.map(reply => `
            <div class="reply-item" data-id="${reply.id}">
                <div class="reply-title">${escapeHtml(reply.title)}</div>
                <div class="reply-text">${escapeHtml(reply.text)}</div>
                <div class="reply-actions">
                    <button class="btn-small btn-edit" data-id="${reply.id}">✏️ Editar</button>
                    <button class="btn-small btn-delete" data-id="${reply.id}">🗑️ Excluir</button>
                </div>
            </div>
        `).join('');

        listContainer.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => editReply(btn.dataset.id));
        });
        listContainer.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => deleteReply(btn.dataset.id));
        });
    });
}

function editReply(id) {
    chrome.storage.sync.get(['quickReplies'], function(result) {
        const replies = result.quickReplies || [];
        const reply = replies.find(r => r.id === id);
        
        if (reply) {
            document.getElementById('replyTitle').value = reply.title;
            document.getElementById('replyText').value = reply.text;
            document.getElementById('submitBtn').textContent = 'Atualizar Resposta';
            editingId = id;
            
            // Scroll para o formulário
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
}

function deleteReply(id) {
    if (!confirm('Tem certeza que deseja excluir esta resposta rápida?')) {
        return;
    }
    
    chrome.storage.sync.get(['quickReplies'], function(result) {
        let replies = result.quickReplies || [];
        replies = replies.filter(r => r.id !== id);
        
        chrome.storage.sync.set({ quickReplies: replies }, function() {
            showAlert('Resposta excluída com sucesso!', 'success');
            loadReplies();
        });
    });
}

function showAlert(message, type) {
    const alertDiv = document.getElementById('alert');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    alertDiv.classList.remove('hidden');
    
    setTimeout(() => {
        alertDiv.classList.add('hidden');
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

