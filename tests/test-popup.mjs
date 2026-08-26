/**
 * Testa popup.html nos tres motores.
 *
 *  - Layout: nada estoura a largura em nenhuma viewport (o popup do Safari no
 *    iOS ocupa a tela toda, entao precisa ceder abaixo dos 400px).
 *  - Degradacao do shim: a pagina roda SEM `chrome`/`browser` definidos,
 *    provando que browser-api.js resolve com fallback em vez de lancar.
 */
import { firefox, webkit, chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Raiz do repositorio, resolvida a partir deste arquivo.
const EXT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

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
console.log('servidor de teste em 127.0.0.1:' + PORT_REAL);

const FAKE = [
  { id: '1', title: 'Lead Handover', text: 'Hello', category: 'Client Engagement', author: 'Carina' },
  { id: '2', title: 'Attempt to Contact', text: 'Outbound Call, left a message', category: 'Sales', author: 'Sistema' },
  { id: '3', title: 'T'.repeat(90), text: 'X'.repeat(500), category: 'Admissions', author: 'N'.repeat(60) }
];

const VIEWPORTS = [
  { name: 'popup desktop 400', width: 400, height: 600 },
  { name: 'popup estreito 320', width: 320, height: 600 },
  { name: 'tela cheia iOS 390', width: 390, height: 844 }
];

const ENGINES = [
  { name: 'Gecko   (Firefox)', launcher: firefox },
  { name: 'WebKit  (Safari) ', launcher: webkit },
  { name: 'Chromium(Chrome/Edge)', launcher: chromium }
];

let failures = 0;
const rows = [];

for (const engine of ENGINES) {
  const browser = await engine.launcher.launch();

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

    await page.addInitScript((fake) => {
      delete window.chrome;
      delete window.browser;
      window.fetch = () => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(fake),
        text: () => Promise.resolve(JSON.stringify(fake))
      });
    }, FAKE);

    await page.goto(`http://127.0.0.1:${PORT_REAL}/popup.html`);
    await page.waitForSelector('.reply-item', { timeout: 8000 }).catch(() => {});

    const r = await page.evaluate(() => {
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

      const catSelect = document.getElementById('replyCategory');

      return {
        items: document.querySelectorAll('.reply-item').length,
        hScroll: root.scrollWidth > root.clientWidth + 1,
        bodyW: Math.round(bodyW),
        overflowing: overflowing.slice(0, 3),
        hasForm: !!document.getElementById('replyForm'),
        catOptions: catSelect ? catSelect.options.length : -1
      };
    });

    // 4 = placeholder + 3 categorias distintas dos dados de teste
    const ok = r.items === 3 && !r.hScroll && r.overflowing.length === 0 &&
      r.hasForm && r.catOptions === 4 && errors.length === 0;
    if (!ok) failures++;

    rows.push({
      engine: engine.name, vp: vp.name, size: `${vp.width}x${vp.height}`,
      itens: r.items, bodyW: r.bodyW,
      barraH: r.hScroll ? 'SIM' : 'nao',
      estouro: r.overflowing.length ? r.overflowing.join(',') : 'nenhum',
      cats: r.catOptions,
      erros: errors.length ? errors.join(' | ').slice(0, 50) : '-',
      ok
    });

    await page.close();
  }
  await browser.close();
}

server.close();

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(pad('MOTOR', 22) + pad('VIEWPORT', 20) + pad('TAMANHO', 10) + pad('ITENS', 7) + pad('BODY', 7) + pad('BARRA-H', 9) + pad('ESTOURO', 22) + pad('CATS', 6) + 'ERROS');
console.log('-'.repeat(115));
for (const r of rows) {
  console.log(pad(r.engine, 22) + pad(r.vp, 20) + pad(r.size, 10) + pad(r.itens, 7) + pad(r.bodyW, 7) +
    pad(r.barraH, 9) + pad(r.estouro, 22) + pad(r.cats, 6) + r.erros);
}
console.log('-'.repeat(115));
console.log(`RESULTADO: ${rows.length - failures}/${rows.length} cenarios passaram`);
process.exit(failures ? 1 : 0);
