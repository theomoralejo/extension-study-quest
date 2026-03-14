const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());

// Permite conexões CORS da extensão (ou de qualquer origem no Zoho)
app.use(cors({ origin: '*' }));

// Configuração do banco
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'PUi4MwLCUwtASDFsdf',
    database: 'study_quest_db'
};

// Cria pool de conexões
const pool = mysql.createPool(dbConfig);

// Testar a conexão na inicialização
pool.getConnection()
    .then(conn => {
        console.log('Conectado ao MySQL com sucesso.');
        conn.release();
    })
    .catch(err => {
        console.error('Erro ao conectar ao MySQL:', err);
    });

// Buscar todas as respostas rápidas
app.get('/api/replies', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM quick_replies ORDER BY createdAt DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar respostas' });
    }
});

// Adicionar uma nova resposta
app.post('/api/replies', async (req, res) => {
    const { id, title, text } = req.body;
    if (!id || !title || !text) return res.status(400).json({ error: 'Faltam dados obrigatórios' });

    try {
        const query = 'INSERT INTO quick_replies (id, title, text) VALUES (?, ?, ?)';
        await pool.query(query, [id, title, text]);
        res.status(201).json({ success: true, message: 'Adicionado com sucesso' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao salvar resposta no MySQL' });
    }
});

// Atualizar uma resposta existente
app.put('/api/replies/:id', async (req, res) => {
    const { title, text } = req.body;
    const { id } = req.params;

    try {
        const query = 'UPDATE quick_replies SET title = ?, text = ? WHERE id = ?';
        await pool.query(query, [title, text, id]);
        res.json({ success: true, message: 'Atualizado com sucesso' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar resposta' });
    }
});

// Excluir uma resposta
app.delete('/api/replies/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM quick_replies WHERE id = ?', [id]);
        res.json({ success: true, message: 'Removido com sucesso' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao excluir resposta' });
    }
});

const PORT = 3050; // Usando porta 3050 pois n8n pode estar na 8000+ ou nginx na 80/443
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend API rodando na porta ${PORT}`);
});
