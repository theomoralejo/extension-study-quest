/**
 * test-varredura.mjs — a varredura incremental do content.js nao perde nada.
 *
 * Pagina de registro com campos, telefones e editor de nota. Confere que os
 * botoes aparecem na carga, em campo que o Zoho insere depois, em componente
 * preenchido por dentro depois, que nada roda com a aba escondida e que tudo
 * aparece quando ela volta. E que a Timeline so e raspada quando a API recusa.
 *
 * Roda: `node tests/test-varredura.mjs`
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const cs = JSON.parse(read("manifest.json")).content_scripts[0];
const stub = `<script>window.__sets=0;globalThis.chrome={runtime:{getURL:p=>p,onMessage:{addListener(){}}},storage:{local:{get:(k,cb)=>cb&&cb({}),set:(o,cb)=>{window.__sets++;cb&&cb()}},onChanged:{addListener(){}}}};</script>`;
let campos = "";
for (let i = 0; i < 10; i++) campos += `<div><label>Field ${i}</label><div class="dv_info_value"><div class="dv_info_value_field"><span>valor ${i}</span></div></div></div>`;
let fones = "";
for (let i = 0; i < 5; i++) fones += `<crux-phone-component><span class="lvPhFld">+44790000000${i}</span></crux-phone-component>`;
const timeline = `<div id="tl"><div><span>Stage was updated from A to B</span></div><div>by Carina 11/09/2026</div><div>13:02</div></div>`;
const html = (tl) => `<!doctype html><html><head><meta charset="utf-8">${cs.css.map((f) => `<style>${read(f)}</style>`).join("")}</head><body>
<div id="campos">${campos}</div><div id="fones">${fones}</div>${tl ? timeline : ""}
${stub}${cs.js.map((f) => `<script>${read(f)}</script>`).join("")}</body></html>`;

let apiOk = true;
const server = http.createServer((req, res) => {
    if (req.url.includes("/settings/fields")) {
        if (!apiOk) { res.writeHead(403); return res.end("{}"); }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ fields: Array.from({ length: 12 }, (_, i) => ({ api_name: "F" + i, field_label: "Field " + i })) }));
    }
    if (req.url.includes("/crm/v")) { res.writeHead(apiOk ? 204 : 403); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html(req.url.includes("tl=1")));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import("playwright");
const browser = await chromium.launch();

let falhas = 0;
const ok = (c, nome, d = "") => { console.log(`${c ? "PASS" : "FALHA"}  ${nome}${c || !d ? "" : " — " + d}`); if (!c) falhas++; };
const conta = (page) => page.evaluate(() => ({
    hist: document.querySelectorAll(".zfh-icon").length,
    wa: document.querySelectorAll(".zoho-wa-btn").length,
    copia: document.querySelectorAll(".zoho-copy-btn").length,
    qr: document.querySelectorAll(".quick-replies-btn").length
}));
const espera = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true, () => false);

{
    const page = await browser.newPage();
    page.on("pageerror", (e) => ok(false, "sem erro de JavaScript", e.message));
    await page.goto(`${BASE}/crm/org1/tab/Potentials/123`);
    await espera(page, () => document.querySelectorAll(".zfh-icon").length >= 10 && document.querySelectorAll(".zoho-copy-btn").length >= 10);
    let c = await conta(page);
    ok(c.hist === 10 && c.wa === 5 && c.copia === 10, "carga: relogio em 10 campos, WhatsApp em 5 telefones, copiar em 10 valores", JSON.stringify(c));

    // Zoho insere um campo, um telefone e o editor de nota depois
    await page.evaluate(() => {
        document.getElementById("campos").insertAdjacentHTML("beforeend", `<div><label>Field 10</label><div class="dv_info_value"><div class="dv_info_value_field"><span>novo</span></div></div></div>`);
        document.getElementById("fones").insertAdjacentHTML("beforeend", `<crux-phone-component><span class="lvPhFld">+447900000009</span></crux-phone-component>`);
        document.body.insertAdjacentHTML("beforeend", `<lyte-note-editor><div class="lyteNoteFooterActions"></div></lyte-note-editor>`);
    });
    ok(await espera(page, () => document.querySelectorAll(".zfh-icon").length === 11 && document.querySelectorAll(".zoho-wa-btn").length === 6 && document.querySelectorAll(".quick-replies-btn").length === 1),
        "campo, telefone e editor inseridos depois ganham os botoes", JSON.stringify(await conta(page)));

    // componente que ja existia e o Zoho preenche por dentro depois
    await page.evaluate(() => {
        const comp = document.createElement("crux-phone-component");
        document.getElementById("fones").appendChild(comp);
        setTimeout(() => { const s = document.createElement("span"); s.className = "lvPhFld"; s.textContent = "+447911111111"; comp.appendChild(s); }, 600);
    });
    ok(await espera(page, () => document.querySelectorAll(".zoho-wa-btn").length === 7), "telefone preenchido depois dentro do componente ganha WhatsApp", JSON.stringify(await conta(page)));

    // editor cujo rodape chega depois
    await page.evaluate(() => {
        const ed = document.createElement("lyte-note-editor");
        document.body.appendChild(ed);
        setTimeout(() => { const f = document.createElement("div"); f.className = "lyteNoteFooterActions"; ed.appendChild(f); }, 600);
    });
    ok(await espera(page, () => document.querySelectorAll(".quick-replies-btn").length === 2), "editor de nota com rodape tardio ganha a bolinha");

    // colar texto grande numa nota (template com muitos campos): nada da extensao entra no editor
    const antes = await conta(page);
    const ms = await page.evaluate(async () => {
        const ed = document.createElement("div");
        ed.contentEditable = "true";
        ed.id = "nota";
        document.body.appendChild(ed);
        const linhas = [];
        for (let i = 0; i < 400; i++) linhas.push("<div>Field " + (i % 12) + "</div><div>valor " + i + "</div>");
        const t0 = performance.now();
        for (let k = 0; k < 20; k++) { ed.insertAdjacentHTML("beforeend", linhas.join("")); await new Promise((r) => setTimeout(r, 50)); }
        await new Promise((r) => setTimeout(r, 1500));
        return performance.now() - t0;
    });
    const dentro = await page.evaluate(() => document.querySelectorAll("#nota .zfh-icon, #nota .zoho-copy-btn, #nota .zoho-wa-btn").length);
    ok(dentro === 0, "colar na nota: nenhum botao da extensao entra no texto do editor", String(dentro));
    const depois = await conta(page);
    ok(depois.hist === antes.hist, "linha colada igual ao nome de um campo nao vira relogio", JSON.stringify([antes, depois]));
    await page.evaluate(() => document.getElementById("nota").remove());

    // aba escondida: nada roda; ao voltar, tudo aparece
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
        document.getElementById("campos").insertAdjacentHTML("beforeend", `<div><label>Field 11</label><div class="dv_info_value"><div class="dv_info_value_field"><span>escondido</span></div></div></div>`);
    });
    await page.waitForTimeout(1500);
    c = await conta(page);
    ok(c.hist === 11 && c.copia === 11, "com a aba em segundo plano a extensao nao varre nada", JSON.stringify(c));
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    ok(await espera(page, () => document.querySelectorAll(".zfh-icon").length === 12 && document.querySelectorAll(".zoho-copy-btn").length === 12),
        "aba volta ao primeiro plano: o campo novo ganha os botoes", JSON.stringify(await conta(page)));

    // pagina parada com relogio mexendo: storage nao e regravado a toa
    const sets = await page.evaluate(() => window.__sets);
    await page.evaluate(() => { const d = document.createElement("div"); document.body.appendChild(d); window.__t = setInterval(() => { d.textContent = Date.now(); }, 100); });
    await page.waitForTimeout(1500);
    ok((await page.evaluate(() => window.__sets)) === sets, "DOM mexendo sem novidade nao grava no storage");
    await page.close();
}

// Timeline: com API ok nao raspa; com API recusada raspa
{
    const page = await browser.newPage();
    await page.goto(`${BASE}/crm/org1/tab/Potentials/124?tl=1`);
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => SQFieldHistory.status());
    ok(st.scraped === 0, "API ok: a Timeline da tela nao e raspada", JSON.stringify(st));
    await page.close();
    apiOk = false;
    const p2 = await browser.newPage();
    await p2.goto(`${BASE}/crm/org1/tab/Potentials/125?tl=1`);
    ok(await espera(p2, () => SQFieldHistory.status().scraped === 1), "API recusada: a Timeline que ja esta na tela e raspada", JSON.stringify(await p2.evaluate(() => SQFieldHistory.status())));
    await p2.close();
    apiOk = true;
}

await browser.close();
server.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou");
process.exit(falhas ? 1 : 0);
