const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// Sessão da extensão: token próprio, só para as respostas rápidas. O token da
// Master Table (acesso total a ela) nunca fica guardado aqui nem na extensão.
const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;
const PRAZO_MASTER_TABLE_MS = 5000;

const SQL_TABELA_SESSOES = `CREATE TABLE IF NOT EXISTS extension_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  KEY idx_extension_sessions_expires (expires_at),
  KEY idx_extension_sessions_user (user_id)
)`;

const hashDoToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Pergunta à Master Table quem é o dono do token PB e se ele tem a flag da extensão. */
function conferenteDaMasterTable(baseUrl, fetchImpl = fetch) {
  return async function conferir(pbToken) {
    const res = await fetchImpl(`${baseUrl}/api/attrio/extensao-study-quest/me`, {
      headers: { Authorization: pbToken },
      signal: AbortSignal.timeout(PRAZO_MASTER_TABLE_MS),
    });
    let corpo = null;
    try { corpo = await res.json(); } catch (_) { corpo = null; }
    return { status: res.status, corpo };
  };
}

function createApp({ pool, apiKey, aceitarChaveAntiga, conferirNaMasterTable, agora = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  // Sem cookie: a credencial é o header Authorization, então origem aberta não dá acesso a ninguém.
  app.use(cors());

  // Log de requisição: método, rota (sem query string, para não gravar segredo), status, tempo.
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    req.id = crypto.randomUUID().slice(0, 8);
    req.rota = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`${new Date().toISOString()} ${req.id} ${req.method} ${req.rota} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });

  // Comparação em tempo constante — `!==` vaza o tamanho do prefixo correto.
  function chaveConfere(recebida) {
    if (!apiKey || typeof recebida !== 'string') return false;
    const a = Buffer.from(recebida);
    const b = Buffer.from(apiKey);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  function falhou(req, res, operacao, erro) {
    console.error(`${new Date().toISOString()} ${req.id} ERRO ${req.method} ${req.rota} — ${operacao}: ${erro.code || ''} ${erro.message}`);
    const semBanco = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(erro.code);
    res.status(semBanco ? 503 : 500).json({
      error: semBanco
        ? `Não foi possível falar com o banco de dados (${erro.code}) ao ${operacao}. ` +
          `O serviço está no ar, mas sem banco — avise o suporte informando a referência ${req.id}.`
        : `Falha ao ${operacao}. Referência ${req.id} — informe ao suporte para localizar no log.`,
      ref: req.id,
    });
  }

  function tokenDoHeader(req) {
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(req.headers.authorization || '');
    return m ? m[1] : null;
  }

  async function lerSessao(token) {
    const [rows] = await pool.execute(
      'SELECT user_id, user_name, user_email, expires_at FROM extension_sessions WHERE token_hash = ? AND expires_at > ?',
      [hashDoToken(token), agora()]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.user_id, name: r.user_name, email: r.user_email, expiresAt: new Date(r.expires_at).toISOString() };
  }

  const semSessao = (res) => res.status(401).json({
    error: 'Sua sessão na extensão expirou ou não existe. Entre de novo com o e-mail e a senha da Master Table.',
    code: 'sessao',
  });

  // ─── Sessão ──────────────────────────────────────────────────────────────
  app.use('/api/auth', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.post('/api/auth/session', async (req, res) => {
    const pbToken = req.body && req.body.pbToken;
    if (typeof pbToken !== 'string' || pbToken.length < 20 || pbToken.length > 4096) {
      return res.status(400).json({ error: 'Pedido sem o login da Master Table. Entre de novo pela extensão.' });
    }
    let resposta;
    try {
      resposta = await conferirNaMasterTable(pbToken);
    } catch (e) {
      console.error(`${new Date().toISOString()} ${req.id} MASTER TABLE inacessível: ${e.name} ${e.message}`);
      return res.status(503).json({
        error: `A Master Table não respondeu a tempo. Tente de novo em instantes; se continuar, avise o suporte (referência ${req.id}).`,
        ref: req.id,
      });
    }
    const { status, corpo } = resposta;
    if (status === 401) {
      return res.status(401).json({ error: 'O login da Master Table expirou. Entre de novo.' });
    }
    if (status === 403) {
      return res.status(403).json({
        error: (corpo && typeof corpo.error === 'string' && corpo.error) ||
          'Sua conta da Master Table não tem acesso à extensão. Peça ao IT para liberar.',
      });
    }
    const valido = status === 200 && corpo && typeof corpo.id === 'string' && corpo.id &&
      typeof corpo.email === 'string' && corpo.email;
    if (!valido) {
      console.error(`${new Date().toISOString()} ${req.id} MASTER TABLE resposta inesperada: status ${status}`);
      return res.status(502).json({
        error: `A Master Table respondeu de um jeito inesperado (${status}). Avise o suporte informando a referência ${req.id}.`,
        ref: req.id,
      });
    }
    const nome = (typeof corpo.name === 'string' && corpo.name.trim()) || corpo.email;
    const token = crypto.randomBytes(32).toString('base64url');
    const expira = new Date(agora().getTime() + DURACAO_SESSAO_MS);
    try {
      await pool.execute('DELETE FROM extension_sessions WHERE expires_at <= ?', [agora()]);
      await pool.execute(
        'INSERT INTO extension_sessions (token_hash, user_id, user_name, user_email, expires_at) VALUES (?, ?, ?, ?, ?)',
        [hashDoToken(token), corpo.id, nome.slice(0, 255), corpo.email.slice(0, 255), expira]
      );
    } catch (e) { return falhou(req, res, 'abrir a sessão da extensão', e); }
    console.log(`${new Date().toISOString()} ${req.id} SESSAO aberta para ${corpo.id}`);
    res.status(201).json({ token, name: nome, email: corpo.email, expiresAt: expira.toISOString() });
  });

  app.get('/api/auth/session', async (req, res) => {
    const token = tokenDoHeader(req);
    if (!token) return semSessao(res);
    try {
      const s = await lerSessao(token);
      if (!s) return semSessao(res);
      res.json({ name: s.name, email: s.email, expiresAt: s.expiresAt });
    } catch (e) { falhou(req, res, 'ler a sessão da extensão', e); }
  });

  app.delete('/api/auth/session', async (req, res) => {
    const token = tokenDoHeader(req);
    if (!token) return res.status(204).send();
    try {
      await pool.execute('DELETE FROM extension_sessions WHERE token_hash = ?', [hashDoToken(token)]);
      res.status(204).send();
    } catch (e) { falhou(req, res, 'encerrar a sessão da extensão', e); }
  });

  // ─── Autorização das respostas ───────────────────────────────────────────
  app.use(['/api/replies', '/api/categories'], async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const token = tokenDoHeader(req);
    if (token) {
      try {
        const s = await lerSessao(token);
        if (!s) return semSessao(res);
        req.usuario = s;
        return next();
      } catch (e) { return falhou(req, res, 'conferir a sessão da extensão', e); }
    }
    // Transição: versões antigas da extensão ainda mandam a chave fixa (pública no GitHub).
    if (aceitarChaveAntiga && chaveConfere(req.headers['x-api-key'])) {
      console.warn(`${new Date().toISOString()} ${req.id} CHAVE ANTIGA usada em ${req.method} ${req.rota}`);
      req.usuario = null;
      return next();
    }
    console.warn(`${new Date().toISOString()} ${req.id} AUTH negada em ${req.rota}`);
    return semSessao(res);
  });

  app.get('/api/replies', async (req, res) => {
    try {
      const [rows] = await pool.execute('SELECT * FROM quick_replies WHERE is_deleted = FALSE ORDER BY createdAt DESC');
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
      // Com sessão, o autor é quem entrou; o nome mandado pelo cliente só vale na transição.
      const autor = req.usuario ? req.usuario.name : (author || 'User');
      await pool.execute(
        'INSERT INTO quick_replies (id, title, text, author, category) VALUES (?, ?, ?, ?, ?)',
        [insertId, title, text, autor, category || 'Geral']
      );
      res.status(201).json({ id: insertId, title, text, author: autor, category });
    } catch (e) { falhou(req, res, 'criar a resposta rápida', e); }
  });

  app.put('/api/replies/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { title, text, author, category } = req.body || {};
      if (!title || !text) {
        return res.status(400).json({ error: 'Informe título e texto da resposta rápida.' });
      }
      // Editar não troca quem criou a resposta.
      const [r] = req.usuario
        ? await pool.execute(
          'UPDATE quick_replies SET title = ?, text = ?, category = ? WHERE id = ?',
          [title, text, category || 'Geral', id])
        : await pool.execute(
          'UPDATE quick_replies SET title = ?, text = ?, author = ?, category = ? WHERE id = ?',
          [title, text, author || 'User', category || 'Geral', id]);
      if (r.affectedRows === 0) {
        return res.status(404).json({ error: `Nenhuma resposta rápida com o id ${id}.` });
      }
      res.json({ id, title, text, category });
    } catch (e) { falhou(req, res, 'editar a resposta rápida', e); }
  });

  app.delete('/api/replies/:id', async (req, res) => {
    try {
      const [r] = await pool.execute('UPDATE quick_replies SET is_deleted = TRUE WHERE id = ?', [req.params.id]);
      if (r.affectedRows === 0) {
        return res.status(404).json({ error: `Nenhuma resposta rápida com o id ${req.params.id}.` });
      }
      res.status(204).send();
    } catch (e) { falhou(req, res, 'excluir a resposta rápida', e); }
  });

  app.delete('/api/categories/:name', async (req, res) => {
    try {
      await pool.execute('UPDATE quick_replies SET is_deleted = TRUE WHERE category = ?', [req.params.name]);
      res.status(204).send();
    } catch (e) { falhou(req, res, 'excluir a categoria', e); }
  });

  // Sonda de saúde: bate NO BANCO, não só no processo. Sem autenticação de propósito.
  app.get(['/api/health', '/health'], async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'ok' });
    } catch (e) {
      console.error(`${new Date().toISOString()} ${req.id} HEALTH falhou: ${e.code || ''} ${e.message}`);
      res.status(503).json({ ok: false, db: 'indisponivel' });
    }
  });

  return app;
}

module.exports = { createApp, conferenteDaMasterTable, hashDoToken, SQL_TABELA_SESSOES, DURACAO_SESSAO_MS };
