/**
 * bench-desempenho.mjs — custo da extensao numa pagina de registro pesada e "viva".
 *
 * Monta um registro com ~6000 elementos (60 campos, timeline, lista) e simula o
 * Zoho mexendo no DOM a cada 700ms (relogio, contadores, linhas novas). Mede o
 * tempo de JavaScript (CDP ScriptDuration) em 10s, com e sem a extensao.
 *
 * Roda: `node tests/bench-desempenho.mjs [pasta-da-extensao]`
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cs = JSON.parse(read("manifest.json")).content_scripts[0];
const stub = `<script>globalThis.chrome={runtime:{getURL:p=>p,onMessage:{addListener(){}}},storage:{local:{get:(k,cb)=>cb&&cb({}),set:(o,cb)=>cb&&cb()},onChanged:{addListener(){}}}};</script>`;

function pagina(comExtensao) {
    let campos = "";
    for (let i = 0; i < 60; i++) campos += `<div class="dvField"><label>Field ${i}</label><div class="dv_info_value"><div class="dv_info_value_field"><span>valor ${i}</span></div></div></div>`;
    let timeline = "";
    for (let i = 0; i < 300; i++) timeline += `<div class="tl"><div><span>Stage was updated from A${i} to B${i}</span></div><div>by Carina 11/09/2026</div><div>13:0${i % 10}</div></div>`;
    let lista = "";
    for (let i = 0; i < 400; i++) lista += `<div class="row"><span>${i}</span><span>Nome ${i}</span><span>email${i}@x.com</span><crux-phone-component cx-prop-value="+4479${i}"><span class="lvPhFld">+4479${String(i).padStart(6, "0")}</span></crux-phone-component></div>`;
    const vivo = `<script>
      let n=0; setInterval(()=>{ n++;
        document.getElementById('clock').textContent=new Date().toISOString();
        const b=document.getElementById('badges'); const s=document.createElement('span'); s.textContent='x'+n; b.appendChild(s); if(b.children.length>20) b.firstChild.remove();
        if(n%5===0){ const d=document.createElement('div'); d.innerHTML='<div><span>tooltip '+n+'</span></div>'; document.body.appendChild(d); setTimeout(()=>d.remove(),150); }
      },700);</script>`;
    const ext = comExtensao
        ? stub + cs.js.map((f) => `<script>${read(f)}</script>`).join("") + cs.css.map((f) => `<style>${read(f)}</style>`).join("")
        : "";
    return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="clock"></div><div id="badges"></div>${campos}${timeline}${lista}${vivo}${ext}</body></html>`;
}

const server = http.createServer((req, res) => {
    if (req.url.includes("/settings/fields")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ fields: Array.from({ length: 60 }, (_, i) => ({ api_name: "F" + i, field_label: "Field " + i })) }));
    }
    if (req.url.includes("/crm/v")) { res.writeHead(204); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pagina(!req.url.includes("sem=1")));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(path.join(path.dirname(new URL(import.meta.url).pathname), "node_modules/playwright/index.mjs"));
const browser = await chromium.launch();

async function medir(url) {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    page.on("pageerror", (e) => console.log("erro na pagina:", e.message));
    await page.goto(url);
    await page.waitForTimeout(3000); // deixa a carga inicial passar
    const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const a = await m();
    await page.waitForTimeout(10000);
    const b = await m();
    await page.close();
    return { script: (b.ScriptDuration - a.ScriptDuration) * 1000, layout: (b.LayoutDuration - a.LayoutDuration) * 1000 };
}

const sem = await medir(`${BASE}/crm/org1/tab/Potentials/123?sem=1`);
const com = await medir(`${BASE}/crm/org1/tab/Potentials/123`);
const r = (x) => x.toFixed(0).padStart(6);
console.log(`pasta: ${ROOT}`);
console.log(`10s de pagina viva  | JS (ms) | layout (ms)`);
console.log(`sem extensao        | ${r(sem.script)}  | ${r(sem.layout)}`);
console.log(`com extensao        | ${r(com.script)}  | ${r(com.layout)}`);
console.log(`custo da extensao   | ${r(com.script - sem.script)}  | ${r(com.layout - sem.layout)}`);
await browser.close();
server.close();
