/**
 * Portao da insercao de resposta no editor de nota.
 *
 * Existe por um defeito que o `harness.html` nao podia pegar: ele modela o
 * `.lyteEditorMainDiv` como `contenteditable="true"`, e no editor real do Zoho
 * (Lyte) esse div e um INVOLUCRO `contenteditable="false"` com o campo editavel
 * dentro. O codigo decidia por `bodyEditor.getAttribute('contenteditable')`, e
 * `getAttribute` devolve STRING — "false" e verdadeira. O involucro passava por
 * editavel e o `range.insertNode` escrevia nos crus no subtree gerenciado pelo
 * Lyte: o texto nao chegava ao campo e o editor ficava com DOM estranho dentro.
 *
 * O portao roda as DUAS formas (involucro e plana) pelas mesmas assercoes, para
 * a correcao de uma nao poder quebrar a outra. As assercoes moram na propria
 * pagina `prova-insercao.html`; aqui e so o motor.
 *
 * Provado nos dois sentidos: com o `getAttribute` de volta no lugar, a forma
 * "involucro" REPROVA com 2 falhas (escreveu no involucro + texto nao chegou).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TESTS = path.dirname(new URL(import.meta.url).pathname);
const RAIZ = path.dirname(TESTS);
const PAGINA = path.join(TESTS, 'prova-insercao.html');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const arq = url.startsWith('/ext/') ? path.join(RAIZ, url.slice(5)) : PAGINA;
  if (!fs.existsSync(arq)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'text/plain' });
  res.end(fs.readFileSync(arq));
});
// Porta 0 = o SO escolhe uma livre. Com porta fixa o teste corre o risco de
// medir a pagina de OUTRO servidor que ja estava no ar — aconteceu.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORTA = server.address().port;

// Os motores que estiverem instalados. Chromium e o minimo; Gecko e WebKit
// entram quando `npm run setup` tiver baixado os tres.
const pw = await import('playwright');
const ENGINES = [
  { nome: 'Chromium', launcher: pw.chromium },
  { nome: 'Gecko   ', launcher: pw.firefox },
  { nome: 'WebKit  ', launcher: pw.webkit }
];

const FORMAS = [
  { nome: 'involucro (Zoho real)', query: '' },
  { nome: 'plana (harness)      ', query: '?forma=plana' },
  { nome: 'lyte (Zoho nov/2026) ', query: '?forma=lyte' }
];

let falhas = 0;
let rodados = 0;

for (const engine of ENGINES) {
  let browser;
  try {
    browser = await engine.launcher.launch();
  } catch (e) {
    console.log(`SKIP  ${engine.nome} — motor nao instalado (npm run setup baixa os tres)`);
    continue;
  }

  for (const forma of FORMAS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

    await page.goto(`http://127.0.0.1:${PORTA}/${forma.query}`);

    // A propria pagina publica o veredito no `document.title`.
    let titulo = 'aguardando';
    try {
      await page.waitForFunction(
        () => document.title === 'APROVADO' || document.title.startsWith('REPROVADO') || document.title === 'ERRO',
        { timeout: 30000 }
      );
      titulo = await page.title();
    } catch (e) {
      titulo = 'SEM VEREDITO (tempo esgotado)';
    }

    const placar = await page.evaluate(() => document.getElementById('placar').innerText);
    rodados++;

    if (titulo === 'APROVADO' && erros.length === 0) {
      console.log(`PASS  ${engine.nome} · ${forma.nome}`);
    } else {
      falhas++;
      console.log(`FAIL  ${engine.nome} · ${forma.nome} — ${titulo}`);
      console.log(placar.split('\n').map((l) => '        ' + l).join('\n'));
      if (erros.length) console.log('        erros de console: ' + erros.join(' | '));
    }

    await page.close();
  }

  await browser.close();
}

server.close();

if (!rodados) {
  console.log('\nNENHUM motor instalado — o portao nao rodou. Rode `npm run setup`.');
  process.exit(1);
}
if (falhas) {
  console.log(`\n${falhas} de ${rodados} cenario(s) REPROVARAM`);
  process.exit(1);
}
console.log(`\nTudo passou (${rodados} cenarios)`);
