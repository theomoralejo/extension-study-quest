const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());

/**
 * Credenciais e chave vem SEMPRE do ambiente — nunca do codigo, que e publico.
 * Falha alto no boot: subir com fallback embutido significa credencial conhecida
 * em producao, e o erro so apareceria quando alguem ja tivesse usado.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variavel de ambiente ${name} nao definida. ` +
      `Configure-a no .env do servidor antes de iniciar a API.`
    );
  }
  return value;
}

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: required('DB_USER'),
  password: required('DB_PASSWORD'),
  database: process.env.DB_NAME || 'study_quest_db',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z'
};

const API_KEY = required('API_KEY');

// Pool unico: antes cada request abria e fechava uma conexao propria, o que
// derruba a API sob carga e vaza conexoes quando a query lanca antes do end().
const pool = mysql.createPool(dbConfig);

// Somente as origens da extensao e do CRM. `cors()` sem argumento libera
// qualquer site a chamar a API com a chave que viaja no bundle publico.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Sem Origin = chamada nao-browser (curl, extensao). A chave decide.
    if (!origin) return callback(null, true);
    if (!ALLOWED_ORIGINS.length) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
}));

/**
 * Autenticacao aplicada na RAIZ da API.
 *
 * Antes o middleware estava montado apenas em '/api/replies', entao
 * DELETE /api/categories/:name — que apaga todas as respostas de uma
 * categoria — respondia sem nenhuma checagem de chave.
 */
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const providedKey = req.headers['x-api-key'];
  if (providedKey !== API_KEY) {
    return res.status(403).json({ error: 'Chave de API ausente ou inválida no header x-api-key.' });
  }
  next();
});

/** Devolve erro com a causa real, sem vazar credencial ou SQL para o cliente. */
function fail(res, error, acao) {
  console.error(`[study-quest-api] falha ao ${acao}:`, error);
  res.status(500).json({ error: `Falha ao ${acao}. Consulte o log do servidor.` });
}

app.get('/api/replies', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM quick_replies WHERE is_deleted = FALSE ORDER BY createdAt DESC'
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'listar as respostas');
  }
});

app.post('/api/replies', async (req, res) => {
  try {
    const { id, title, text, author, category } = req.body || {};

    if (!title || !text) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes: title e text.' });
    }

    const insertId = id || Date.now().toString();
    await pool.execute(
      'INSERT INTO quick_replies (id, title, text, author, category) VALUES (?, ?, ?, ?, ?)',
      [insertId, title, text, author || 'User', category || 'Geral']
    );
    res.status(201).json({ id: insertId, title, text, author, category });
  } catch (error) {
    fail(res, error, 'criar a resposta');
  }
});

app.put('/api/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, author, category } = req.body || {};

    if (!title || !text) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes: title e text.' });
    }

    const [result] = await pool.execute(
      'UPDATE quick_replies SET title = ?, text = ?, author = ?, category = ? WHERE id = ?',
      [title, text, author || 'User', category || 'Geral', id]
    );

    // 0 linhas afetadas = o id nao existe. Responder 200 faria a extensao
    // dizer "atualizado" para uma escrita que nao aconteceu.
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Resposta não encontrada.' });
    }

    res.json({ id, title, text, author, category });
  } catch (error) {
    fail(res, error, 'atualizar a resposta');
  }
});

app.delete('/api/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE quick_replies SET is_deleted = TRUE WHERE id = ? AND is_deleted = FALSE',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Resposta não encontrada.' });
    }

    res.status(204).send();
  } catch (error) {
    fail(res, error, 'excluir a resposta');
  }
});

// Excluir uma categoria inteira
app.delete('/api/categories/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const [result] = await pool.execute(
      'UPDATE quick_replies SET is_deleted = TRUE WHERE category = ? AND is_deleted = FALSE',
      [name]
    );
    res.json({ category: name, removed: result.affectedRows });
  } catch (error) {
    fail(res, error, 'excluir a categoria');
  }
});

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
