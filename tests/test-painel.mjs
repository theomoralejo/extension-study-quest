/**
 * Testa o painel injetado da extensao nos tres motores que importam:
 * Gecko (Firefox), WebKit (Safari) e Chromium (Chrome/Edge).
 *
 * O que se prova aqui:
 *  1. Os scripts carregam e injetam o botao em cada motor.
 *  2. O painel abre e a lista renderiza.
 *  3. O painel fica DENTRO da viewport — inclusive com o botao encostado em
 *     cada canto e com a janela estreita, que e o caso que quebrava antes.
 *  4. Nenhum card estoura a largura do painel (texto longo sem espacos).
 *  5. Nenhum erro de console em nenhum motor.
 */
import { firefox, webkit, chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Raiz do repositorio, resolvida a partir deste arquivo.
const EXT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HARNESS = path.join(EXT_DIR, 'tests', 'harness.html');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = url.startsWith('/ext/') ? path.join(EXT_DIR, url.slice(5)) : HARNESS;
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
// Porta 0 = o SO escolhe uma livre. Porta fixa corre o risco de
// outro servidor ja estar la e o teste medir a pagina DELE.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT_REAL = server.address().port;
console.log('servidor de teste em 127.0.0.1:' + PORT_REAL);

// Cantos + uma janela estreita: cada cenario coloca o botao onde o painel
// tinha como escapar da tela na versao anterior.
const SCENARIOS = [
  { name: 'canto sup-esq',      viewport: { width: 1280, height: 800 }, editor: { top: 4,   left: 4 } },
  { name: 'canto sup-dir',      viewport: { width: 1280, height: 800 }, editor: { top: 4,   right: 4 } },
  { name: 'canto inf-dir',      viewport: { width: 1280, height: 800 }, editor: { bottom: 4, right: 4 } },
  { name: 'canto inf-esq',      viewport: { width: 1280, height: 800 }, editor: { bottom: 4, left: 4 } },
  { name: 'janela estreita 360',viewport: { width: 360,  height: 720 }, editor: { top: 200, left: 180 } },
  { name: 'janela baixa 500',   viewport: { width: 900,  height: 500 }, editor: { bottom: 40, right: 200 } }
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

  for (const sc of SCENARIOS) {
    const page = await browser.newPage({ viewport: sc.viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${PORT_REAL}/harness.html`);

    // Posiciona o editor no canto do cenario.
    await page.evaluate((pos) => {
      const ed = document.getElementById('editor');
      ed.style.top = ed.style.left = ed.style.right = ed.style.bottom = '';
      for (const [k, v] of Object.entries(pos)) ed.style[k] = v + 'px';
    }, sc.editor);

    // content.js roda a primeira varredura 2s apos carregar.
    await page.waitForSelector('.quick-replies-btn', { timeout: 8000 }).catch(() => {});
    const hasButton = await page.locator('.quick-replies-btn').count() > 0;

    let verdict = { hasButton, opened: false, inViewport: false, noOverflow: false, items: 0 };

    if (hasButton) {
      await page.locator('.quick-replies-btn').click();
      await page.waitForSelector('.quick-reply-item', { timeout: 8000 }).catch(() => {});

      verdict = await page.evaluate(() => {
        const panel = document.querySelector('.quick-replies-panel');
        if (!panel) return { hasButton: true, opened: false, inViewport: false, noOverflow: false, items: 0 };

        const r = panel.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        // Tolerancia de 1px para arredondamento de layout entre motores.
        const inViewport = r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1;

        // Nenhum card pode ser mais largo que a area de lista do painel.
        const list = panel.querySelector('.quick-replies-list');
        const listW = list.getBoundingClientRect().width;
        const items = [...panel.querySelectorAll('.quick-reply-item')];
        const noOverflow = items.every((i) => i.getBoundingClientRect().width <= listW + 1)
          && list.scrollWidth <= list.clientWidth + 1;

        return { hasButton: true, opened: true, inViewport, noOverflow, items: items.length,
                 rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
                 vw, vh };
      });
    }

    const ok = verdict.hasButton && verdict.opened && verdict.inViewport && verdict.noOverflow
      && verdict.items === 5 && errors.length === 0;
    if (!ok) failures++;

    rows.push({
      engine: engine.name,
      scenario: sc.name,
      viewport: `${sc.viewport.width}x${sc.viewport.height}`,
      btn: verdict.hasButton ? 'sim' : 'NAO',
      abriu: verdict.opened ? 'sim' : 'NAO',
      dentroDaTela: verdict.inViewport ? 'sim' : 'NAO',
      semOverflow: verdict.noOverflow ? 'sim' : 'NAO',
      itens: verdict.items,
      rect: verdict.rect ? `${verdict.rect.l},${verdict.rect.t}→${verdict.rect.r},${verdict.rect.b}` : '-',
      erros: errors.length ? errors.join(' | ').slice(0, 80) : '-',
      ok
    });

    await page.close();
  }

  await browser.close();
}

server.close();

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(pad('MOTOR', 22) + pad('CENARIO', 20) + pad('VIEWPORT', 10) + pad('BTN', 5) + pad('ABRIU', 7) + pad('NA TELA', 9) + pad('S/OVERFLOW', 12) + pad('ITENS', 7) + pad('PAINEL l,t→r,b', 20) + 'ERROS');
console.log('-'.repeat(125));
for (const r of rows) {
  console.log(pad(r.engine, 22) + pad(r.scenario, 20) + pad(r.viewport, 10) + pad(r.btn, 5) + pad(r.abriu, 7) +
    pad(r.dentroDaTela, 9) + pad(r.semOverflow, 12) + pad(r.itens, 7) + pad(r.rect, 20) + r.erros);
}
console.log('-'.repeat(125));
console.log(`RESULTADO: ${rows.length - failures}/${rows.length} cenarios passaram`);
process.exit(failures ? 1 : 0);
