/**
 * Verifica que a API que a extensao chama esta alcancavel POR UM BROWSER,
 * cross-origin, nos tres motores.
 *
 * Isto e diferente de checar com `curl`: o curl segue redirect e ignora CORS,
 * entao ele responde 200 numa URL em que a extensao morre. Como as chamadas
 * mandam o header `x-api-key`, o browser faz um preflight OPTIONS antes — e
 * um redirect na resposta do preflight aborta tudo com "Failed to fetch".
 *
 * A pagina e servida em 127.0.0.1, logo o fetch e cross-origin de verdade e
 * dispara o mesmo preflight que dispara dentro do Zoho.
 *
 * Faz apenas LEITURA (GET) contra a API.
 */
import { firefox, webkit, chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EXT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// A base real usada pela extensao, lida do config (fonte unica).
const cfgSrc = fs.readFileSync(path.join(EXT_DIR, 'config.js'), 'utf8');
const API_BASE = /var API_BASE = '([^']+)'/.exec(cfgSrc)[1];
const API_KEY = /var API_KEY = '([^']+)'/.exec(cfgSrc)[1];

// A base antiga entra como CONTROLE NEGATIVO: ela precisa FALHAR, senao o
// teste nao esta medindo o CORS de verdade.
const LEGACY_BASE = 'https://cv.studyquestuk.com/api';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>ok</body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const ENGINES = [
  { name: 'Gecko   (Firefox)', launcher: firefox },
  { name: 'WebKit  (Safari) ', launcher: webkit },
  { name: 'Chromium(Chrome/Edge)', launcher: chromium }
];

const TARGETS = [
  { label: 'API em uso (config.js)', base: API_BASE, mustPass: true },
  { label: 'controle: base antiga', base: LEGACY_BASE, mustPass: false }
];

let failures = 0;
const rows = [];

for (const engine of ENGINES) {
  const browser = await engine.launcher.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);

  for (const t of TARGETS) {
    const result = await page.evaluate(async ({ base, key }) => {
      try {
        const res = await fetch(base + '/replies', { headers: { 'x-api-key': key } });
        if (!res.ok) return { ok: false, why: 'HTTP ' + res.status };
        const data = await res.json();
        return { ok: true, count: Array.isArray(data) ? data.length : -1 };
      } catch (e) {
        // CORS barrado chega aqui como TypeError sem detalhe.
        return { ok: false, why: (e && e.message) || String(e) };
      }
    }, { base: t.base, key: API_KEY });

    const behavedAsExpected = result.ok === t.mustPass;
    if (!behavedAsExpected) failures++;

    rows.push({
      engine: engine.name,
      alvo: t.label,
      esperado: t.mustPass ? 'carregar' : 'falhar',
      obtido: result.ok ? `carregou (${result.count} respostas)` : `falhou: ${result.why}`.slice(0, 44),
      veredito: behavedAsExpected ? 'OK' : 'INESPERADO'
    });
  }

  await browser.close();
}

server.close();

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(`API em uso: ${API_BASE}`);
console.log('');
console.log(pad('MOTOR', 22) + pad('ALVO', 24) + pad('ESPERADO', 11) + pad('OBTIDO', 46) + 'VEREDITO');
console.log('-'.repeat(112));
for (const r of rows) {
  console.log(pad(r.engine, 22) + pad(r.alvo, 24) + pad(r.esperado, 11) + pad(r.obtido, 46) + r.veredito);
}
console.log('-'.repeat(112));
console.log(`RESULTADO: ${rows.length - failures}/${rows.length} comportaram-se como esperado`);
process.exit(failures ? 1 : 0);
