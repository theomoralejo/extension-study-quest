const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { createApp, conferenteDaMasterTable, SQL_TABELA_SESSOES } = require('./app');

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
const PORT = Number(process.env.PORT || 3050);
const MASTER_TABLE_URL = process.env.MASTER_TABLE_URL || 'https://api.master.studyquestuk.com';

// Transição: a chave fixa (pública no GitHub) só vale enquanto ACEITAR_CHAVE_ANTIGA=1.
const aceitarChaveAntiga = process.env.ACEITAR_CHAVE_ANTIGA === '1';
const apiKey = aceitarChaveAntiga ? obrigatorio('API_KEY') : null;

const pool = mysql.createPool(DB);
const app = createApp({
  pool,
  apiKey,
  aceitarChaveAntiga,
  conferirNaMasterTable: conferenteDaMasterTable(MASTER_TABLE_URL),
});

pool.query(SQL_TABELA_SESSOES).catch((e) => {
  console.error(`[boot] não consegui garantir a tabela extension_sessions: ${e.code || ''} ${e.message}. ` +
    'O login da extensão vai falhar até a tabela existir.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `${new Date().toISOString()} [boot] study-quest-api na porta ${PORT} · ` +
    `banco ${DB.user}@${DB.host}:${DB.port}/${DB.database} · pool ${DB.connectionLimit} · ` +
    `master table ${MASTER_TABLE_URL} · chave antiga ${aceitarChaveAntiga ? 'ACEITA (transição)' : 'recusada'}`
  );
});
