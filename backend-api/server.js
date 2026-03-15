const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
  host: '127.0.0.1',
  user: 'studyquest',
  password: 'studyquest',
  database: 'study_quest_db'
};

const API_KEY = 'sq-54321-secret-key';
app.use('/api/replies', (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const providedKey = req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.get('/api/replies', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM quick_replies ORDER BY createdAt DESC');
    connection.end();
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro' });
  }
});

app.post('/api/replies', async (req, res) => {
  try {
    const { id, title, text, author, category } = req.body;
    const insertId = id || Date.now().toString();
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
      'INSERT INTO quick_replies (id, title, text, author, category) VALUES (?, ?, ?, ?, ?)',
      [insertId, title, text, author || 'User', category || 'Geral']
    );
    connection.end();
    res.status(201).json({ id: insertId, title, text, author, category });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, author, category } = req.body;
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
      'UPDATE quick_replies SET title = ?, text = ?, author = ?, category = ? WHERE id = ?',
      [title, text, author || 'User', category || 'Geral', id]
    );
    connection.end();
    res.json({ id, title, text, author, category });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro' });
  }
});

app.delete('/api/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('DELETE FROM quick_replies WHERE id = ?', [id]);
    connection.end();
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro' });
  }
});

// Excluir uma categoria inteira
app.delete('/api/categories/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('DELETE FROM quick_replies WHERE category = ?', [name]);
    connection.end();
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir categoria' });
  }
});

const PORT = 3050;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
