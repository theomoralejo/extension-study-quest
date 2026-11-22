// node --test backend-api/test  — roda o app REAL (app.js) com banco e Master Table falsos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp, hashDoToken, DURACAO_SESSAO_MS } = require('../app.js');

const CHAVE = 'chave-antiga-de-teste-123';
const PB_OK = 'pb-token-valido-'.padEnd(40, 'x');

// Banco falso: só as consultas que o app faz. Consulta desconhecida = falha alta.
function bancoFalso() {
  const sessoes = new Map();
  const respostas = [];
  const pool = {
    sessoes, respostas,
    async query(sql) { if (sql !== 'SELECT 1') throw new Error('query inesperada: ' + sql); return [[{ 1: 1 }]]; },
    async execute(sql, p) {
      if (sql.startsWith('SELECT user_id')) {
        const s = sessoes.get(p[0]);
        return [s && s.expires_at > p[1] ? [s] : []];
      }
      if (sql.startsWith('DELETE FROM extension_sessions WHERE expires_at')) {
        for (const [k, s] of sessoes) if (s.expires_at <= p[0]) sessoes.delete(k);
        return [{}];
      }
      if (sql.startsWith('DELETE FROM extension_sessions WHERE token_hash')) { sessoes.delete(p[0]); return [{}]; }
      if (sql.startsWith('INSERT INTO extension_sessions')) {
        sessoes.set(p[0], { user_id: p[1], user_name: p[2], user_email: p[3], expires_at: p[4] });
        return [{}];
      }
      if (sql.startsWith('SELECT * FROM quick_replies')) return [respostas.filter((r) => !r.is_deleted)];
      if (sql.startsWith('INSERT INTO quick_replies')) {
        respostas.push({ id: p[0], title: p[1], text: p[2], author: p[3], category: p[4], is_deleted: false });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE quick_replies SET title = ?, text = ?, category = ?')) {
        const r = respostas.find((x) => x.id === p[3]);
        if (!r) return [{ affectedRows: 0 }];
        Object.assign(r, { title: p[0], text: p[1], category: p[2] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE quick_replies SET title = ?, text = ?, author = ?')) {
        const r = respostas.find((x) => x.id === p[4]);
        if (!r) return [{ affectedRows: 0 }];
        Object.assign(r, { title: p[0], text: p[1], author: p[2], category: p[3] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE quick_replies SET is_deleted = TRUE WHERE id')) {
        const r = respostas.find((x) => x.id === p[0]);
        if (!r) return [{ affectedRows: 0 }];
        r.is_deleted = true;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE quick_replies SET is_deleted = TRUE WHERE category')) {
        respostas.filter((x) => x.category === p[0]).forEach((x) => { x.is_deleted = true; });
        return [{ affectedRows: 1 }];
      }
      throw new Error('execute inesperado: ' + sql);
    },
  };
  return pool;
}

async function subir({ aceitarChaveAntiga = false, masterTable, relogio } = {}) {
  const pool = bancoFalso();
  const chamadasMT = [];
  const conferir = masterTable || (async (t) => {
    chamadasMT.push(t);
    if (t === PB_OK) return { status: 200, corpo: { id: 'u1', name: 'Carina Teste', email: 'carina@x.com' } };
    return { status: 401, corpo: { error: 'expired' } };
  });
  const app = createApp({ pool, apiKey: CHAVE, aceitarChaveAntiga, conferirNaMasterTable: conferir, agora: relogio });
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = async (metodo, rota, { corpo, headers = {} } = {}) => {
    const res = await fetch(base + rota, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { json = null; }
    return { status: res.status, json, headers: res.headers };
  };
  return { pool, chamadasMT, chamar, fechar: () => new Promise((ok) => server.close(ok)) };
}

async function entrar(api) {
  const r = await api.chamar('POST', '/api/auth/session', { corpo: { pbToken: PB_OK } });
  assert.equal(r.status, 201);
  return r.json.token;
}

test('sem login: respostas e categorias recusam com 401 code=sessao', async () => {
  const api = await subir();
  try {
    for (const [m, rota] of [['GET', '/api/replies'], ['POST', '/api/replies'], ['PUT', '/api/replies/1'],
      ['DELETE', '/api/replies/1'], ['DELETE', '/api/categories/Geral']]) {
      const r = await api.chamar(m, rota, { corpo: m === 'GET' || m === 'DELETE' ? undefined : { title: 't', text: 'x' } });
      assert.equal(r.status, 401, `${m} ${rota}`);
      assert.equal(r.json.code, 'sessao');
    }
  } finally { await api.fechar(); }
});

test('chave antiga: recusada por padrão, aceita só com ACEITAR_CHAVE_ANTIGA', async () => {
  const fechado = await subir();
  const aberto = await subir({ aceitarChaveAntiga: true });
  try {
    assert.equal((await fechado.chamar('GET', '/api/replies', { headers: { 'x-api-key': CHAVE } })).status, 401);
    assert.equal((await aberto.chamar('GET', '/api/replies', { headers: { 'x-api-key': CHAVE } })).status, 200);
    assert.equal((await aberto.chamar('GET', '/api/replies', { headers: { 'x-api-key': CHAVE + 'x' } })).status, 401);
  } finally { await fechado.fechar(); await aberto.fechar(); }
});

test('login: troca o token PB por sessão própria; banco guarda só o hash', async () => {
  const api = await subir();
  try {
    const r = await api.chamar('POST', '/api/auth/session', { corpo: { pbToken: PB_OK } });
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(r.json).sort(), ['email', 'expiresAt', 'name', 'token']);
    assert.equal(r.json.name, 'Carina Teste');
    assert.notEqual(r.json.token, PB_OK);
    assert.deepEqual(api.chamadasMT, [PB_OK]);
    const guardado = [...api.pool.sessoes.keys()];
    assert.deepEqual(guardado, [hashDoToken(r.json.token)]);
    assert.ok(!JSON.stringify([...api.pool.sessoes.values()]).includes(r.json.token));
    assert.ok(!JSON.stringify([...api.pool.sessoes.values()]).includes(PB_OK));
    const s = await api.chamar('GET', '/api/auth/session', { headers: { Authorization: `Bearer ${r.json.token}` } });
    assert.equal(s.status, 200);
    assert.equal(s.json.email, 'carina@x.com');
  } finally { await api.fechar(); }
});

test('login: Master Table 401/403/erro/resposta estranha viram 401/403/503/502', async () => {
  const casos = [
    [async () => ({ status: 401, corpo: {} }), 401],
    [async () => ({ status: 403, corpo: { error: 'Ask IT to enable your role.' } }), 403, 'Ask IT to enable your role.'],
    [async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, 503],
    [async () => ({ status: 200, corpo: { id: '', email: '' } }), 502],
    [async () => ({ status: 500, corpo: null }), 502],
  ];
  for (const [mt, esperado, msg] of casos) {
    const api = await subir({ masterTable: mt });
    try {
      const r = await api.chamar('POST', '/api/auth/session', { corpo: { pbToken: PB_OK } });
      assert.equal(r.status, esperado);
      if (msg) assert.equal(r.json.error, msg);
      assert.equal(api.pool.sessoes.size, 0, 'nenhuma sessão aberta em falha');
    } finally { await api.fechar(); }
  }
});

test('login sem pbToken válido: 400 sem chamar a Master Table', async () => {
  const api = await subir();
  try {
    for (const corpo of [{}, { pbToken: 'curto' }, { pbToken: 123 }]) {
      assert.equal((await api.chamar('POST', '/api/auth/session', { corpo })).status, 400);
    }
    assert.equal(api.chamadasMT.length, 0);
  } finally { await api.fechar(); }
});

test('com sessão: autor vem do login, e editar não troca o autor', async () => {
  const api = await subir();
  try {
    const token = await entrar(api);
    const h = { Authorization: `Bearer ${token}` };
    const c = await api.chamar('POST', '/api/replies', { headers: h, corpo: { id: 'r1', title: 'T', text: 'X', author: 'Falso', category: 'Sales' } });
    assert.equal(c.status, 201);
    assert.equal(api.pool.respostas[0].author, 'Carina Teste');
    api.pool.respostas[0].author = 'Mauro';
    const e = await api.chamar('PUT', '/api/replies/r1', { headers: h, corpo: { title: 'T2', text: 'X2', author: 'Falso' } });
    assert.equal(e.status, 200);
    assert.equal(api.pool.respostas[0].author, 'Mauro');
    assert.equal(api.pool.respostas[0].title, 'T2');
    assert.equal((await api.chamar('GET', '/api/replies', { headers: h })).json.length, 1);
    assert.equal((await api.chamar('DELETE', '/api/replies/r1', { headers: h })).status, 204);
    assert.equal((await api.chamar('DELETE', '/api/replies/nao-existe', { headers: h })).status, 404);
  } finally { await api.fechar(); }
});

test('sair apaga a sessão; token apagado ou vencido volta a dar 401', async () => {
  let agora = new Date('2026-11-22T12:00:00Z');
  const api = await subir({ relogio: () => agora });
  try {
    const t1 = await entrar(api);
    assert.equal((await api.chamar('DELETE', '/api/auth/session', { headers: { Authorization: `Bearer ${t1}` } })).status, 204);
    assert.equal((await api.chamar('GET', '/api/replies', { headers: { Authorization: `Bearer ${t1}` } })).status, 401);

    const t2 = await entrar(api);
    agora = new Date(agora.getTime() + DURACAO_SESSAO_MS - 1000);
    assert.equal((await api.chamar('GET', '/api/replies', { headers: { Authorization: `Bearer ${t2}` } })).status, 200);
    agora = new Date(agora.getTime() + 2000);
    assert.equal((await api.chamar('GET', '/api/replies', { headers: { Authorization: `Bearer ${t2}` } })).status, 401);
    // o próximo login limpa as vencidas
    await entrar(api);
    assert.equal(api.pool.sessoes.size, 1);
  } finally { await api.fechar(); }
});

test('Bearer malformado ou desconhecido não abre nada', async () => {
  const api = await subir({ aceitarChaveAntiga: true });
  try {
    for (const auth of ['Bearer ', 'Bearer abc', `Bearer ${'a'.repeat(43)}`, `Basic ${'a'.repeat(43)}`]) {
      assert.equal((await api.chamar('GET', '/api/replies', { headers: { Authorization: auth } })).status, 401, auth);
    }
    // Bearer inválido não cai para a chave antiga
    const r = await api.chamar('GET', '/api/replies', { headers: { Authorization: `Bearer ${'a'.repeat(43)}`, 'x-api-key': CHAVE } });
    assert.equal(r.status, 401);
  } finally { await api.fechar(); }
});

test('health não exige login', async () => {
  const api = await subir();
  try { assert.equal((await api.chamar('GET', '/api/health')).status, 200); } finally { await api.fechar(); }
});
