/**
 * Testa popup.html nos tres motores.
 *
 *  - Layout: nada estoura a largura em nenhuma viewport (o popup do Safari no
 *    iOS ocupa a tela toda, entao precisa ceder abaixo dos 400px), nos DOIS
 *    estados: sem sessao (so o card "Entrar") e com sessao (o app).
 *  - Degradacao do shim: sem sessao, a pagina roda SEM `chrome`/`browser`
 *    definidos, provando que browser-api.js resolve com fallback em vez de lancar.
 *  - Sem sessao, nada do app aparece (escondido, nao desabilitado) e o foco
 *    esta no e-mail.
 *  - Login de ponta a ponta com fetch falso: Master Table → /auth/session →
 *    "Conectado como"; erro de senha aparece na area role=alert; Sair volta ao login.
 *
 * `SHOTS=<pasta>` salva prints 390px (logado e deslogado) no Chromium.
 */
import { firefox, webkit, chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Raiz do repositorio, resolvida a partir deste arquivo.
const EXT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const SHOTS = process.env.SHOTS || '';

const server = http.createServer((req, res) => {
  const file = path.join(EXT_DIR, req.url.split('?')[0]);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
// Porta 0 = o SO escolhe uma livre. Porta fixa corre o risco de
// outro servidor ja estar la e o teste medir a pagina DELE.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT_REAL = server.address().port;
const BASE = `http://127.0.0.1:${PORT_REAL}/popup.html`;
console.log('servidor de teste em 127.0.0.1:' + PORT_REAL);

const FAKE = [
  { id: '1', title: 'Lead Handover', text: 'Hello', category: 'Client Engagement', author: 'Carina' },
  { id: '2', title: 'Attempt to Contact', text: 'Outbound Call, left a message', category: 'Sales', author: 'Sistema' },
  { id: '3', title: 'T'.repeat(90), text: 'X'.repeat(500), category: 'Admissions', author: 'N'.repeat(60) }
];
const SESSAO = { token: 'tk', name: 'Carina Souza da Silva Albuquerque', email: 'carina@studyquestuk.com', expiresAt: '2999-01-01T00:00:00Z' };

const VIEWPORTS = [
  { name: 'popup desktop 400', width: 400, height: 600 },
  { name: 'popup estreito 320', width: 320, height: 600 },
  { name: 'tela cheia iOS 390', width: 390, height: 844 }
];

// `MOTORES=chromium` (lista por virgula) roda so os motores que a maquina tem.
const ENGINES = [
  { id: 'firefox', name: 'Gecko   (Firefox)', launcher: firefox },
  { id: 'webkit', name: 'WebKit  (Safari) ', launcher: webkit },
  { id: 'chromium', name: 'Chromium(Chrome/Edge)', launcher: chromium }
].filter((e) => !process.env.MOTORES || process.env.MOTORES.split(',').includes(e.id));

/**
 * Storage da extensao em memoria (com onChanged), e fetch falso que responde
 * a Master Table e a API pelo caminho. `cfg.sessao` = sessao inicial ou null;
 * `cfg.pb` = resposta do auth-with-password.
 */
function initScript(cfg) {
  if (!cfg.comChrome) { delete window.chrome; delete window.browser; }
  window.__chamadas = [];
  window.fetch = (url, o) => {
    url = String(url);
    window.__chamadas.push({ url, method: (o && o.method) || 'GET', headers: (o && o.headers) || {}, body: o && o.body });
    let st = 200, out = cfg.replies;
    if (url.includes('auth-with-password')) { st = cfg.pb.status; out = cfg.pb.body; }
    else if (url.endsWith('/auth/session')) { st = (o && o.method) === 'DELETE' ? 204 : 201; out = cfg.novaSessao; }
    return Promise.resolve({ ok: st < 300, status: st, json: () => Promise.resolve(out), text: () => Promise.resolve(out === undefined ? '' : JSON.stringify(out)) });
  };
  if (!cfg.comChrome) return;
  const store = cfg.sessao ? { sqSessao: cfg.sessao } : {};
  const ouvintes = [];
  const avisar = (ch) => setTimeout(() => ouvintes.forEach((f) => f(ch, 'local')), 0);
  window.__store = store;
  window.chrome = {
    runtime: { id: 't', getURL: (x) => x },
    storage: {
      local: {
        get: (k) => { const o = {}; [].concat(k).forEach((x) => { if (x in store) o[x] = store[x]; }); return Promise.resolve(o); },
        set: (i) => { const ch = {}; Object.keys(i).forEach((k) => { ch[k] = { newValue: i[k] }; store[k] = i[k]; }); avisar(ch); return Promise.resolve(); },
        remove: (k) => { const ch = {}; [].concat(k).forEach((x) => { ch[x] = { oldValue: store[x] }; delete store[x]; }); avisar(ch); return Promise.resolve(); }
      },
      onChanged: { addListener: (f) => ouvintes.push(f) }
    },
    tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve(null) }
  };
}

const medirLayout = () => {
  const root = document.documentElement;
  const bodyW = document.body.getBoundingClientRect().width;
  const overflowing = [];
  const all = document.body.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const box = all[i].getBoundingClientRect();
    if (box.width > 0 && (box.right > bodyW + 1 || box.left < -1)) {
      const el = all[i];
      const name = typeof el.className === 'string' && el.className ? el.className : el.tagName;
      overflowing.push(String(name).slice(0, 20));
    }
  }
  const visivel = (id) => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0; };
  const catSelect = document.getElementById('replyCategory');
  return {
    items: document.querySelectorAll('.reply-item').length,
    hScroll: root.scrollWidth > root.clientWidth + 1,
    bodyW: Math.round(bodyW),
    overflowing: overflowing.slice(0, 3),
    login: visivel('loginForm'),
    app: visivel('replyForm') || visivel('repliesList') || visivel('btnLogout'),
    foco: document.activeElement && document.activeElement.id,
    catOptions: catSelect ? catSelect.options.length : -1,
    quem: (document.getElementById('sessionName') || {}).textContent
  };
};

let failures = 0;
const rows = [];
const extra = [];
const check = (cond, nome, detalhe = '') => { extra.push(`${cond ? 'PASS' : 'FALHA'}  ${nome}${cond || !detalhe ? '' : ' — ' + detalhe}`); if (!cond) failures++; };

for (const engine of ENGINES) {
  const browser = await engine.launcher.launch();

  for (const vp of VIEWPORTS) {
    for (const estado of ['sem sessao', 'com sessao']) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

      const logado = estado === 'com sessao';
      await page.addInitScript(initScript, { comChrome: logado, sessao: logado ? SESSAO : null, replies: FAKE });
      await page.goto(BASE);
      if (logado) await page.waitForSelector('.reply-item', { timeout: 8000 }).catch(() => {});
      else await page.waitForSelector('#loginForm:not(.is-hidden)', { timeout: 8000 }).catch(() => {});

      const r = await page.evaluate(medirLayout);
      // 4 = placeholder + 3 categorias distintas dos dados de teste
      const ok = !r.hScroll && r.overflowing.length === 0 && errors.length === 0 && (logado
        ? r.items === 3 && r.catOptions === 4 && r.app && !r.login && r.quem === SESSAO.name
        : r.login && !r.app && r.items === 0 && r.foco === 'loginEmail');
      if (!ok) failures++;

      if (SHOTS && engine.launcher === chromium && vp.width === 390) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `popup-390-${logado ? 'logado' : 'deslogado'}.png`), fullPage: !logado });
      }

      rows.push({
        engine: engine.name, vp: vp.name + ' · ' + estado, size: `${vp.width}x${vp.height}`,
        itens: r.items, bodyW: r.bodyW,
        barraH: r.hScroll ? 'SIM' : 'nao',
        estouro: r.overflowing.length ? r.overflowing.join(',') : 'nenhum',
        tela: r.login ? 'login' : (r.app ? 'app' : '?'),
        erros: errors.length ? errors.join(' | ').slice(0, 50) : '-',
        ok
      });
      await page.close();
    }
  }

  // ---- fluxo de login (uma vez por motor, viewport do popup) ----
  {
    const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
    await page.addInitScript(initScript, {
      comChrome: true, sessao: null, replies: FAKE,
      pb: { status: 400, body: { message: 'Failed to authenticate.' } },
      novaSessao: { token: 'novo', name: 'Mauro Ribeiro', email: 'mauro@x', expiresAt: '2999-01-01T00:00:00Z' }
    });
    await page.goto(BASE);
    await page.waitForSelector('#loginForm:not(.is-hidden)');
    await page.fill('#loginEmail', 'mauro@x');
    await page.fill('#loginPassword', 'errada');
    await page.press('#loginPassword', 'Enter');
    await page.waitForFunction(() => document.getElementById('loginError').textContent !== '', null, { timeout: 4000 }).catch(() => {});
    const erro = await page.textContent('#loginError');
    check(erro === 'E-mail ou senha incorretos. Use o mesmo login da Master Table.', `${engine.name}: Enter envia; senha errada mostra a mensagem em role=alert`, erro);
    check((await page.getAttribute('#loginError', 'role')) === 'alert', `${engine.name}: area de erro e role=alert`);
    check((await page.inputValue('#loginPassword')) === '', `${engine.name}: senha errada limpa o campo de senha`);

    // agora a Master Table aceita
    await page.evaluate(() => {
      const f = window.fetch;
      window.fetch = (url, o) => String(url).includes('auth-with-password')
        ? new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: () => Promise.resolve({ token: 'PB' }), text: () => Promise.resolve('{"token":"PB"}') }), 300))
        : f(url, o);
    });
    await page.fill('#loginPassword', 'certa');
    await page.click('#loginBtn');
    const carregando = await page.evaluate(() => ({ t: document.getElementById('loginBtn').textContent, d: document.getElementById('loginBtn').disabled }));
    check(carregando.t === 'Entrando…' && carregando.d, `${engine.name}: durante o login o botao diz "Entrando…" e fica desabilitado`, JSON.stringify(carregando));
    await page.waitForSelector('.reply-item', { timeout: 4000 }).catch(() => {});
    const depois = await page.evaluate(() => ({
      quem: document.querySelector('.session-who').textContent.replace(/\s+/g, ' ').trim(),
      store: JSON.stringify(window.__store),
      post: window.__chamadas.filter((c) => c.url.includes('/replies')).map((c) => c.headers.Authorization)
    }));
    check(depois.quem === 'Conectado como Mauro Ribeiro', `${engine.name}: depois do login aparece "Conectado como <nome>"`, depois.quem);
    check(!depois.store.includes('PB') && !depois.store.includes('certa'), `${engine.name}: storage sem token PB e sem senha`, depois.store);
    check(depois.post.length > 0 && depois.post.every((h) => h === 'Bearer novo'), `${engine.name}: lista carregada com o Bearer novo`, JSON.stringify(depois.post));

    // salvar nao manda author
    await page.fill('#replyTitle', 'Nova');
    await page.fill('#replyText', 'Texto');
    await page.click('#submitBtn');
    await page.waitForFunction(() => window.__chamadas.some((c) => c.method === 'POST' && c.url.endsWith('/replies')), null, { timeout: 3000 }).catch(() => {});
    const post = await page.evaluate(() => window.__chamadas.find((c) => c.method === 'POST' && c.url.endsWith('/replies')));
    const corpo = post ? JSON.parse(post.body) : null;
    check(corpo && !('author' in corpo) && corpo.title === 'Nova', `${engine.name}: resposta nova vai sem author (o servidor assina)`, post && post.body);

    await page.click('#btnLogout');
    await page.waitForSelector('#loginForm:not(.is-hidden)', { timeout: 3000 }).catch(() => {});
    const saiu = await page.evaluate(() => ({
      login: !document.getElementById('loginForm').classList.contains('is-hidden'),
      del: window.__chamadas.some((c) => c.method === 'DELETE' && c.url.endsWith('/auth/session')),
      store: JSON.stringify(window.__store),
      lista: document.getElementById('repliesList').textContent
    }));
    check(saiu.login && saiu.del && saiu.store === '{}' && saiu.lista === '', `${engine.name}: Sair chama DELETE, apaga a sessao, limpa a lista e volta ao login`, JSON.stringify(saiu));
    await page.close();
  }

  // ---- 401 no meio do uso volta ao login dizendo por que ----
  {
    const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
    await page.addInitScript(initScript, { comChrome: true, sessao: SESSAO, replies: FAKE });
    await page.addInitScript(() => {
      const f = window.fetch;
      window.fetch = (url, o) => String(url).endsWith('/replies')
        ? Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'x', code: 'sessao' }), text: () => Promise.resolve('{"error":"x"}') })
        : f(url, o);
    });
    await page.goto(BASE);
    await page.waitForFunction(() => document.getElementById('loginError').textContent !== '', null, { timeout: 4000 }).catch(() => {});
    const r = await page.evaluate(() => ({ erro: document.getElementById('loginError').textContent, login: !document.getElementById('loginForm').classList.contains('is-hidden'), store: JSON.stringify(window.__store) }));
    check(r.login && /sessão expirou/.test(r.erro) && r.store === '{}', `${engine.name}: 401 apaga a sessao e volta ao login com o motivo`, JSON.stringify(r));
    await page.close();
  }

  await browser.close();
}

server.close();

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(pad('MOTOR', 22) + pad('VIEWPORT', 34) + pad('TAMANHO', 10) + pad('ITENS', 7) + pad('BODY', 7) + pad('BARRA-H', 9) + pad('ESTOURO', 12) + pad('TELA', 7) + 'ERROS');
console.log('-'.repeat(120));
for (const r of rows) {
  console.log(pad(r.engine, 22) + pad(r.vp, 34) + pad(r.size, 10) + pad(r.itens, 7) + pad(r.bodyW, 7) +
    pad(r.barraH, 9) + pad(r.estouro, 12) + pad(r.tela, 7) + r.erros + (r.ok ? '' : '   <-- FALHA'));
}
console.log('-'.repeat(120));
extra.forEach((l) => console.log(l));
const total = rows.length + extra.length;
console.log(`RESULTADO: ${total - failures}/${total} cenarios passaram`);
process.exit(failures ? 1 : 0);
