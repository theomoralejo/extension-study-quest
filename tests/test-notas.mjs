/**
 * test-notas.mjs — painel lateral de notas (notes-panel.js) num Zoho de mentira.
 *
 * Serve uma pagina em /crm/org1/tab/Potentials/123 com os scripts reais da
 * extensao e responde a API de Notes do Zoho por rota. Confere: aba so em
 * pagina de registro, lista da mais nova para a mais velha, HTML de nota vira
 * texto (sem executar), estado vazio, gravacao com o corpo que a doc v8 pede,
 * texto preservado quando o Zoho recusa, e painel dentro da tela em 390/1280px.
 *
 * Roda: `node tests/test-notas.mjs` (precisa do `npm run setup` uma vez).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cs = manifest.content_scripts[0];
// content.js fica de fora: o teste chama tick() direto, sem o observer.
const scripts = cs.js.filter((f) => f !== "content.js").map((f) => `<script>${read(f)}</script>`).join("\n");
const css = cs.css.map((f) => `<style>${read(f)}</style>`).join("\n");

const html = `<!doctype html><html style="font-size:10px"><head><meta charset="utf-8">${css}</head>
<body style="margin:0"><style>button,textarea{font-size:30px}</style><div style="height:3000px">Deal</div>${scripts}</body></html>`;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let falhas = 0;
const ok = (cond, nome, detalhe = "") => {
    console.log(`${cond ? "PASS" : "FALHA"}  ${nome}${cond || !detalhe ? "" : " — " + detalhe}`);
    if (!cond) falhas++;
};

const pw = await import("playwright");
const browser = await pw.chromium.launch();

async function abrir(notas, { postStatus = 201 } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const estado = { notas: notas.slice(), posts: [], xss: false };
    await page.exposeFunction("__xss", () => { estado.xss = true; });
    await page.route("**/crm/v8/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname.endsWith("/settings/modules")) {
            return route.fulfill({ json: { modules: [{ api_name: "Deals", module_name: "Potentials" }] } });
        }
        if (url.pathname.endsWith("/Deals/123/Notes") && req.method() === "GET") {
            if (!estado.notas.length) return route.fulfill({ status: 204, body: "" });
            return route.fulfill({ json: { data: estado.notas, info: { more_records: false } } });
        }
        if (url.pathname.endsWith("/Deals/123/Notes") && req.method() === "POST") {
            const body = JSON.parse(req.postData());
            estado.posts.push(body);
            if (postStatus !== 201) return route.fulfill({ status: postStatus, json: { data: [{ code: "MANDATORY_NOT_FOUND", message: "required field not found", status: "error" }] } });
            estado.notas.push({ id: "n9", Note_Content: body.data[0].Note_Content, Created_Time: "2026-11-06T16:00:00-03:00", Created_By: { name: "Mauro" } });
            return route.fulfill({ status: 201, json: { data: [{ code: "SUCCESS", details: { id: "n9" }, status: "success" }] } });
        }
        return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(`${BASE}/crm/org1/tab/Potentials/123`);
    await page.evaluate(() => SQNotesPanel.tick());
    return { page, estado };
}

const NOTAS = [
    { id: "a", Note_Content: "Mais antiga", Created_Time: "2026-11-01T09:00:00-03:00", Created_By: { name: "Ana" } },
    { id: "b", Note_Title: "Ligação", Note_Content: "Linha 1<br>Linha 2<img src=x onerror=\"__xss()\">", Created_Time: "2026-11-05T14:00:00-03:00", Created_By: { name: "Mauro" } }
];

// ---- lista ----
{
    const { page, estado } = await abrir(NOTAS);
    ok(await page.isVisible(".sqn-tab"), "aba Notas aparece em pagina de registro");
    ok(await page.isHidden(".sqn-panel"), "painel comeca fechado");
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-note");
    const autores = await page.$$eval(".sqn-author", (els) => els.map((e) => e.textContent));
    ok(autores.join(",") === "Mauro,Ana", "mais nova no topo", autores.join(","));
    ok((await page.textContent(".sqn-count")) === "2 notas", "contador de notas");
    const corpo = await page.textContent(".sqn-note .sqn-body");
    ok(corpo.includes("Linha 1\nLinha 2") && !corpo.includes("<"), "HTML da nota vira texto com quebra de linha", JSON.stringify(corpo));
    await page.waitForTimeout(200);
    ok(!estado.xss && (await page.$$(".sqn-list img")).length === 0, "HTML da nota nao executa nem injeta elemento");

    // O Zoho tem raiz menor e estilo proprio em button/textarea: o painel nao pode herdar nada disso.
    const fs = await page.evaluate(() => ["sqn-panel", "sqn-body", "sqn-input", "sqn-send"].map((c) => parseFloat(getComputedStyle(document.querySelector("." + c)).fontSize)));
    ok(fs[0] === 16 && fs[1] === 16 && fs[2] === 16 && fs[3] === 15, "tamanho de fonte independe da raiz e do CSS do Zoho (16/16/16/15px)", fs.join("/"));
    const tabR = await page.$eval(".sqn-tab", (e) => e.getBoundingClientRect().right);
    const panL = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect().left);
    ok(tabR <= panL + 1, "aba aberta fica encostada fora do painel, sem cobrir", `aba.right=${tabR} painel.left=${panL}`);

    // ---- gravar ----
    ok(await page.isDisabled(".sqn-send"), "botao desabilitado com campo vazio");
    await page.fill(".sqn-input", "Aluno confirmou janeiro");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 3);
    const p = estado.posts[0]?.data?.[0];
    ok(p && p.Note_Content === "Aluno confirmou janeiro" && p.Parent_Id?.id === "123" && p.Parent_Id?.module?.api_name === "Deals",
        "POST com Note_Content e Parent_Id {module.api_name: Deals, id}", JSON.stringify(estado.posts[0]));
    ok((await page.inputValue(".sqn-input")) === "", "campo limpa depois de salvar");
    ok((await page.textContent(".sqn-note .sqn-body")) === "Aluno confirmou janeiro", "nota nova aparece no topo");

    // ---- dentro da tela ----
    for (const w of [1280, 390]) {
        await page.setViewportSize({ width: w, height: 700 });
        const r = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect().toJSON());
        ok(r.left >= 0 && r.right <= w && r.top >= 0 && r.bottom <= 700, `painel dentro da tela em ${w}px`, JSON.stringify(r));
    }

    // ---- sair do registro ----
    await page.evaluate(() => { history.pushState({}, "", "/crm/org1/tab/Potentials/list"); SQNotesPanel.tick(); });
    ok(await page.isHidden(".sqn-tab"), "aba some fora de pagina de registro");
    await page.close();
}

// ---- template pelo botao da Study Quest no painel ----
{
    const { page, estado } = await abrir(NOTAS);
    // content.js fica de fora do teste: o painel de templates e simulado no mesmo contrato (toggle(botao, onPick)).
    await page.evaluate(() => { globalThis.SQQuickReplies = { toggle: (btn, onPick) => onPick("Cobro docs", "Oi! Faltam os documentos.") }; });
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-note");
    ok(await page.isVisible(".sqn-qr img"), "botao da Study Quest aparece no rodape do painel");
    await page.fill(".sqn-input", "Antes ");
    await page.click(".sqn-qr");
    ok((await page.inputValue(".sqn-input")) === "Antes Oi! Faltam os documentos.", "template entra no campo, no cursor", await page.inputValue(".sqn-input"));
    ok((await page.textContent(".sqn-title-text")) === "Cobro docs", "titulo do template aparece como Titulo da nota");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 3);
    ok(estado.posts[0]?.data?.[0]?.Note_Title === "Cobro docs", "nota sai com Note_Title do template", JSON.stringify(estado.posts[0]));
    ok(await page.isHidden(".sqn-title-chip"), "titulo some depois de salvar");
    await page.close();
}

// ---- vazio ----
{
    const { page } = await abrir([]);
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-empty");
    ok((await page.textContent(".sqn-empty")).includes("Escreva a primeira"), "estado vazio explica e aponta o campo");
    await page.close();
}

// ---- Zoho recusa a gravacao ----
{
    const { page } = await abrir(NOTAS, { postStatus: 400 });
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-note");
    await page.fill(".sqn-input", "Texto que nao pode sumir");
    await page.click(".sqn-send");
    await page.waitForSelector(".sqn-error-inline:not([hidden])");
    ok((await page.inputValue(".sqn-input")) === "Texto que nao pode sumir", "texto fica no campo quando o Zoho recusa");
    ok((await page.textContent(".sqn-error-inline")).includes("required field not found"), "erro mostra a causa que o Zoho deu");
    await page.close();
}

// ---- historico de campo em qualquer modulo (Contact), pelo resolvedor unico ----
{
    const page = await browser.newPage();
    const pedidas = [];
    await page.route("**/crm/v8/**", (route) => {
        const u = new URL(route.request().url());
        pedidas.push(u.pathname);
        if (u.pathname.endsWith("/settings/modules")) {
            return route.fulfill({ json: { modules: [{ api_name: "Contacts", module_name: "Contacts", singular_label: "Contact" }] } });
        }
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`${BASE}/crm/org1/tab/Contacts/777`);
    await page.evaluate(() => SQFieldHistory.tick());
    await page.waitForTimeout(500);
    ok(pedidas.some((p) => p.endsWith("/Contacts/777/__timeline")), "historico de campo le a Timeline de um Contact", pedidas.join(" "));
    await page.close();
}

await browser.close();
server.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou");
process.exit(falhas ? 1 : 0);
