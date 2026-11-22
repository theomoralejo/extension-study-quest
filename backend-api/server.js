const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

// ─────────────────────────────────────────────────────────────────────────────
// Config: tudo vem do .env ao lado deste arquivo (chmod 600).
// Sem dependência nova: o container sobe com `node server.js` fixo, então não dá
// para usar `--env-file` (mudar o CMD exigiria recriar o container, e recriar
// sorteia porta nova e quebra a rota do vhost).
// ─────────────────────────────────────────────────────────────────────────────
function carregaEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;                       // comentário, linha vazia, lixo
    if (process.env[m[1]] !== undefined) continue; // env real do container vence
    const bruto = m[2].trim();
    // Aspas abertas e não fechadas = linha malformada. Sem este aviso o valor
    // entra COM a aspa dentro e a falha aparece só como "senha errada".
    if (/^['"]/.test(bruto) && !/^(['"])(.*)\1$/.test(bruto)) {
      console.warn(`[boot] ${m[1]} no .env começa com aspas e não fecha — o valor vai com a aspa dentro. Confira a linha.`);
    }
    process.env[m[1]] = bruto.replace(/^(['"])(.*)\1$/, '$2');
  }
}
carregaEnv(path.join(__dirname, '.env'));

// Fail-hard: sem segredo o processo NÃO sobe. Nada de fallback conhecido no
// código — fallback é a porta dos fundos que ninguém lembra de fechar.
function obrigatorio(nome) {
  const v = process.env[nome];
  if (!v) {
    console.error(
      `[boot] FALTA a variável ${nome}. Ela vive no .env ao lado do server.js ` +
      `(chmod 600). O processo não sobe sem ela — corrija o .env e reinicie o container.`
    );
    process.exit(1);
  }
  return v;
}

const DB = {
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  user: obrigatorio('DB_USER'),
  password: obrigatorio('DB_PASSWORD'),
  database: obrigatorio('DB_NAME'),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 5),
  timezone: 'Z',
};
const API_KEY = obrigatorio('API_KEY');
const PORT = Number(process.env.PORT || 3050);

const pool = mysql.createPool(DB);

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cors());

// ─────────────────────────────────────────────────────────────────────────────
// Log de requisição: método, rota, status, tempo. É o que faltava quando o
// container ficou fora da rede do banco e passou dias devolvendo 500 em
// silêncio — o único rastro estava no stack trace, sem dizer QUAL rota.
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  req.id = crypto.randomUUID().slice(0, 8);
  // A rota é capturada AGORA, no começo: `req.path` é reescrito pelo router
  // quando um middleware montado responde, e no `finish` já valeria "/" — o log
  // erraria a rota justamente nas requisições negadas. E a query string é
  // cortada de propósito: quem mandar a chave em `?key=` não a grava no log.
  req.rota = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(
      `${new Date().toISOString()} ${req.id} ${req.method} ${req.rota} ` +
      `${res.statusCode} ${ms.toFixed(1)}ms`
    );
  });
  next();
});

// Comparação em tempo constante — `!==` vaza o tamanho do prefixo correto.
function chaveConfere(recebida) {
  if (typeof recebida !== 'string') return false;
  const a = Buffer.from(recebida);
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.use(['/api/replies', '/api/categories'], (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (!chaveConfere(req.headers['x-api-key'])) {
    console.warn(`${new Date().toISOString()} ${req.id} AUTH negada em ${req.rota}`);
    return res.status(403).json({ error: 'Chave de API ausente ou inválida no header x-api-key.' });
  }
  next();
});

// Erro: log interno com a causa REAL (é ele que teria escancarado o ENOTFOUND
// mysql no primeiro dia) + resposta que diz o que falhou e o que fazer, sem
// devolver stack nem credencial para o cliente.
function falhou(req, res, operacao, erro) {
  console.error(
    `${new Date().toISOString()} ${req.id} ERRO ${req.method} ${req.rota} — ` +
    `${operacao}: ${erro.code || ''} ${erro.message}`
  );
  const semBanco = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(erro.code);
  res.status(semBanco ? 503 : 500).json({
    error: semBanco
      ? `Não foi possível falar com o banco de dados (${erro.code}) ao ${operacao}. ` +
        `O serviço está no ar, mas sem banco — avise o suporte informando a referência ${req.id}.`
      : `Falha ao ${operacao}. Referência ${req.id} — informe ao suporte para localizar no log.`,
    ref: req.id,
  });
}

app.get('/api/replies', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM quick_replies WHERE is_deleted = FALSE ORDER BY createdAt DESC'
    );
    res.json(rows);
  } catch (e) { falhou(req, res, 'listar as respostas rápidas', e); }
});

app.post('/api/replies', async (req, res) => {
  try {
    const { id, title, text, author, category } = req.body || {};
    if (!title || !text) {
      return res.status(400).json({ error: 'Informe título e texto da resposta rápida.' });
    }
    const insertId = id || Date.now().toString();
    await pool.execute(
      'INSERT INTO quick_replies (id, title, text, author, category) VALUES (?, ?, ?, ?, ?)',
      [insertId, title, text, author || 'User', category || 'Geral']
    );
    res.status(201).json({ id: insertId, title, text, author, category });
  } catch (e) { falhou(req, res, 'criar a resposta rápida', e); }
});

app.put('/api/replies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, author, category } = req.body || {};
    if (!title || !text) {
      return res.status(400).json({ error: 'Informe título e texto da resposta rápida.' });
    }
    const [r] = await pool.execute(
      'UPDATE quick_replies SET title = ?, text = ?, author = ?, category = ? WHERE id = ?',
      [title, text, author || 'User', category || 'Geral', id]
    );
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: `Nenhuma resposta rápida com o id ${id}.` });
    }
    res.json({ id, title, text, author, category });
  } catch (e) { falhou(req, res, 'editar a resposta rápida', e); }
});

app.delete('/api/replies/:id', async (req, res) => {
  try {
    const [r] = await pool.execute(
      'UPDATE quick_replies SET is_deleted = TRUE WHERE id = ?', [req.params.id]
    );
    if (r.affectedRows === 0) {
      return res.status(404).json({ error: `Nenhuma resposta rápida com o id ${req.params.id}.` });
    }
    res.status(204).send();
  } catch (e) { falhou(req, res, 'excluir a resposta rápida', e); }
});

// Excluir uma categoria inteira
app.delete('/api/categories/:name', async (req, res) => {
  try {
    await pool.execute(
      'UPDATE quick_replies SET is_deleted = TRUE WHERE category = ?', [req.params.name]
    );
    res.status(204).send();
  } catch (e) { falhou(req, res, 'excluir a categoria', e); }
});

// Sonda de saúde: bate NO BANCO, não só no processo. "Processo vivo" foi
// exatamente a leitura que escondeu a falha da rede.
// `/api/health` porque o vhost só roteia `/api/` para este app — sonda em
// `/health` cai no outro backend do mesmo domínio e nunca chega aqui.
// Sem chave de propósito (é sonda), e por isso a resposta não devolve o código
// interno do erro: quem precisa do detalhe lê o log.
app.get(['/api/health', '/health'], async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'ok' });
  } catch (e) {
    console.error(`${new Date().toISOString()} ${req.id} HEALTH falhou: ${e.code || ''} ${e.message}`);
    res.status(503).json({ ok: false, db: 'indisponivel' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `${new Date().toISOString()} [boot] study-quest-api na porta ${PORT} · ` +
    `banco ${DB.user}@${DB.host}:${DB.port}/${DB.database} · pool ${DB.connectionLimit}`
  );
});
