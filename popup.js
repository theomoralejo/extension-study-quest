// Popup.js - Gerenciamento de Quick Replies
let editingId = null;
let currentAuthor = '';

document.addEventListener('DOMContentLoaded', function () {
    loadReplies();

    document.getElementById('replyForm').addEventListener('submit', handleSubmit);

    // Tentar carregar do cache antes de perguntar pra tab
    chrome.storage.local.get(['zohoAuthor'], function(result) {
        if (result.zohoAuthor) {
            currentAuthor = result.zohoAuthor;
        }
    });

    // Auto Extrair o autor do Zoho para a variavel caso esteja na aba ativa agora
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0] && tabs[0].url && tabs[0].url.includes('zoho')) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getAuthor' }, function (response) {
                if (chrome.runtime.lastError) return; // ignore se não estiver no zoho
                if (response && response.author) {
                    currentAuthor = response.author;
                    chrome.storage.local.set({ zohoAuthor: currentAuthor });
                }
            });
        }
    });

    // Togglers para Categoria
    const btnNew = document.getElementById('btnNewCategory');
    const btnCancel = document.getElementById('btnCancelCategory');
    const wrapSelect = document.getElementById('categorySelectWrap');
    const wrapInput = document.getElementById('categoryInputWrap');
    const catSelect = document.getElementById('replyCategory');
    const catInput = document.getElementById('newCategoryInput');

    btnNew.addEventListener('click', () => {
        wrapSelect.style.display = 'none';
        wrapInput.style.display = 'flex';
        catInput.focus();
        catSelect.removeAttribute('required');
        catInput.setAttribute('required', 'true');
    });

    btnCancel.addEventListener('click', () => {
        wrapInput.style.display = 'none';
        wrapSelect.style.display = 'flex';
        catInput.value = '';
        catInput.removeAttribute('required');
        catSelect.setAttribute('required', 'true');
    });
});

function handleSubmit(e) {
    e.preventDefault();

    const title = document.getElementById('replyTitle').value.trim();
    const text = document.getElementById('replyText').value.trim();

    // Obter categoria
    const wrapInput = document.getElementById('categoryInputWrap');
    let category = '';
    if (wrapInput.style.display === 'flex') {
        category = document.getElementById('newCategoryInput').value.trim();
    } else {
        category = document.getElementById('replyCategory').value;
    }

    if (!category) category = 'Geral'; // Fallback

    // O Autor é apenas o valor em memória, ou um padrão se não pegou nada
    const author = currentAuthor || 'Sistema';

    if (!title || !text) {
        showAlert('Por favor, preencha todos os campos obrigatórios', 'error');
        return;
    }

    // Save directly to API
    const replyData = {
        id: editingId !== null ? editingId : Date.now().toString(),
        title: title,
        text: text,
        category: category,
        author: author
    };

    const url = editingId !== null
        ? 'https://cv.studyquestuk.com/api/replies/' + editingId
        : 'https://cv.studyquestuk.com/api/replies';

    const method = editingId !== null ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'sq-54321-secret-key'
        },
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
    fetch('https://cv.studyquestuk.com/api/replies', {
        headers: { 'x-api-key': 'sq-54321-secret-key' }
    })
        .then(res => res.json())
        .then(replies => {
            // Preencher select de categorias
            const allCategories = [...new Set(replies.map(r => r.category).filter(Boolean))].sort();
            const catSelect = document.getElementById('replyCategory');

            // Limpa as opções anteriores (mantendo o placeholder)
            catSelect.innerHTML = '<option value="" disabled selected>Selecione uma categoria...</option>';

            allCategories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                catSelect.appendChild(opt);
            });

            // Preencher select de filtro (se houver no popup.html)
            const filterSelect = document.getElementById('categoryFilter');
            if (filterSelect) {
                filterSelect.innerHTML = '<option value="">Todas Categorias</option>';
                allCategories.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat;
                    opt.textContent = cat;
                    filterSelect.appendChild(opt);
                });
            }

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
                    <div class="reply-title">
                       ${escapeHtml(reply.title)} 
                       <span style="font-size: 11px; background: #eee; padding: 2px 6px; border-radius: 4px; color: #555; font-weight: normal; margin-left: 6px;">${escapeHtml(reply.category || 'Geral')}</span>
                    </div>
                    <div class="reply-text">${escapeHtml(reply.text)}</div>
                    <div style="font-size: 11px; color: #888; margin-bottom: 8px;">Por: ${escapeHtml(reply.author || 'User')}</div>
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
    fetch('https://cv.studyquestuk.com/api/replies', {
        headers: { 'x-api-key': 'sq-54321-secret-key' }
    })
        .then(res => res.json())
        .then(replies => {
            const reply = replies.find(r => r.id === id);

            if (reply) {
                document.getElementById('replyTitle').value = reply.title;
                document.getElementById('replyText').value = reply.text;

                // Setar categoria no select
                const catSelect = document.getElementById('replyCategory');
                const catInput = document.getElementById('newCategoryInput');
                const wrapSelect = document.getElementById('categorySelectWrap');
                const wrapInput = document.getElementById('categoryInputWrap');

                // Verificar se a categoria da resposta existe nas options
                let optionExists = false;
                for (let i = 0; i < catSelect.options.length; i++) {
                    if (catSelect.options[i].value === reply.category) {
                        optionExists = true;
                        catSelect.selectedIndex = i;
                        break;
                    }
                }

                if (!optionExists && reply.category) {
                    // Categoria solta, mostramos no input
                    wrapSelect.style.display = 'none';
                    wrapInput.style.display = 'flex';
                    catInput.value = reply.category;
                    catSelect.removeAttribute('required');
                    catInput.setAttribute('required', 'true');
                } else {
                    wrapInput.style.display = 'none';
                    wrapSelect.style.display = 'flex';
                    catInput.value = '';
                    catInput.removeAttribute('required');
                    catSelect.setAttribute('required', 'true');
                }

                document.getElementById('submitBtn').textContent = 'Atualizar Resposta';
                editingId = id;

                // Scroll para o formulário
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
}

// Excluir Resposta
function deleteReply(id) {
    if (!confirm('Tem certeza que deseja excluir esta resposta rápida?')) {
        return;
    }

    fetch('https://cv.studyquestuk.com/api/replies/' + id, {
        method: 'DELETE',
        headers: { 'x-api-key': 'sq-54321-secret-key' }
    })
        .then(res => {
            if (!res.ok) throw new Error('Erro na resposta do servidor');
            showAlert('Resposta excluída com sucesso!', 'success');
            loadReplies();
        })
        .catch(err => {
            console.error(err);
            showAlert('Erro ao excluir no banco de dados', 'error');
        });
}

// Exibir botão de apagar categoria quando se seleciona uma categoria, ou esconder.
document.getElementById('replyCategory').addEventListener('change', function (e) {
    const btnDel = document.getElementById('btnDeleteCategory');
    if (e.target.value) {
        btnDel.style.display = 'inline-block';
        btnDel.onclick = () => deleteCategory(e.target.value);
    } else {
        btnDel.style.display = 'none';
        btnDel.onclick = null;
    }
});

// Excluir Categoria Inteira
function deleteCategory(name) {
    if (!confirm('ATENÇÃO: Você está prestes a excluir a categoria "' + name + '" e TODAS as respostas nela contidas. Tem certeza?')) {
        return;
    }

    fetch('https://cv.studyquestuk.com/api/categories/' + encodeURIComponent(name), {
        method: 'DELETE',
        headers: { 'x-api-key': 'sq-54321-secret-key' }
    })
        .then(res => {
            if (!res.ok) throw new Error('Erro na resposta do servidor');
            showAlert('Categoria excluída com sucesso!', 'success');
            // Reset fields
            document.getElementById('replyCategory').value = '';
            document.getElementById('btnDeleteCategory').style.display = 'none';
            loadReplies();
        })
        .catch(err => {
            console.error(err);
            showAlert('Erro ao excluir categoria no banco de dados', 'error');
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

