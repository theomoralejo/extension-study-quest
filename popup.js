// Popup.js - Gerenciamento de Quick Replies
let editingId = null;

document.addEventListener('DOMContentLoaded', function () {
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

    // Save directly to API
    const replyData = {
        id: editingId !== null ? editingId : Date.now().toString(),
        title: title,
        text: text
    };

    const url = editingId !== null
        ? `https://cv.studyquestuk.com/api/replies/${editingId}`
        : 'https://cv.studyquestuk.com/api/replies';

    const method = editingId !== null ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replyData)
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            showAlert(editingId ? 'Resposta atualizada com sucesso!' : 'Resposta adicionada com sucesso!', 'success');
            editingId = null;
            document.getElementById('submitBtn').textContent = 'Adicionar Resposta Rápida';
            document.getElementById('replyForm').reset();
            loadReplies();
        })
        .catch(err => {
            console.error(err);
            showAlert('Erro ao salvar no banco de dados', 'error');
        });
}

function loadReplies() {
    fetch('https://cv.studyquestuk.com/api/replies')
        .then(res => res.json())
        .then(replies => {
            const listContainer = document.getElementById('repliesList');

            if (!replies || replies.length === 0) {
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
        })
        .catch(err => {
            console.error('Erro ao carregar respostas:', err);
            document.getElementById('repliesList').innerHTML = '<div class="empty-state">Erro ao conectar ao banco de dados.</div>';
        });
}

function editReply(id) {
    fetch('https://cv.studyquestuk.com/api/replies')
        .then(res => res.json())
        .then(replies => {
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

    fetch(`https://cv.studyquestuk.com/api/replies/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            showAlert('Resposta excluída com sucesso!', 'success');
            loadReplies();
        })
        .catch(err => {
            console.error(err);
            showAlert('Erro ao excluir no banco de dados', 'error');
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

