/**
 * test-deal-info.mjs — cabecalho do Deal no painel de Notas (deal-info.js) num Zoho de mentira.
 *
 * Mesmo esquema do test-notas.mjs: scripts reais da extensao, API do Zoho por rota.
 * Confere os valores do deal de exemplo (Sonia), cores dos selos de dias, linha de
 * selos em UMA linha ate a largura minima do painel (288px), campos vazios, stage
 * longo, Important notes (abrir/fechar lembrado, editar, salvar, cancelar, erro),
 * falha do Deal sem quebrar as notas, COQL recusada, outro modulo e troca de deal.
 *
 * Roda: `node tests/test-deal-info.mjs`. Prints: SQ_SHOTS=/pasta node tests/test-deal-info.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cs = manifest.content_scripts[0];
const scripts = cs.js.filter((f) => f !== "content.js").map((f) => `<script>${read(f)}</script>`).join("\n");
const css = cs.css.map((f) => `<style>${read(f)}</style>`).join("\n");
const html = `<!doctype html><html style="font-size:10px"><head><meta charset="utf-8">${css}</head>
<body style="margin:0;background:#f3f4f6"><style>button,textarea{font-size:30px}</style><div style="height:3000px">Deal</div>${scripts}</body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html); });
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SHOTS = process.env.SQ_SHOTS || "";

let falhas = 0;
const ok = (cond, nome, detalhe = "") => {
    console.log(`${cond ? "PASS" : "FALHA"}  ${nome}${cond || !detalhe ? "" : " — " + detalhe}`);
    if (!cond) falhas++;
};

const SONIA = {
    id: "123", Owner: { name: "Marcos Henrique", id: "1" }, Submitted_by: "Joao Amaral", Stage: "Conditional offer", Formula_19: 1,
    Sales_person1: { name: "Adriana Lioni", id: "2" }, Student_Consultant: { name: "Isabela Freitas", id: "3" },
    Contact_Pipeline: "Need to Schedule Assessments", Days_on_This_stage: 1, DSA: "No", Speaking: "5",
    All_Conditions_Met: "Requested", Number_7: 0, Contact_Name: { name: "Sonia", id: "999" }, Number_of_applications: "2",
    Important_Notes1: "A aluna teve a sua aplicacao pela LCAE rejeitada pela rota profissional e vamos tentar a LCCA para o foundation agora."
};
const VAZIO = { id: "123", Owner: null, Submitted_by: null, Stage: null, Formula_19: null, Sales_person1: null, Student_Consultant: null,
    Contact_Pipeline: null, Days_on_This_stage: null, DSA: null, Speaking: null, All_Conditions_Met: null, Number_7: null,
    Important_Notes1: null, Contact_Name: null, Number_of_applications: null };
const NOTAS = [{ id: "a", Note_Title: "Conditional Offer", Note_Content: "No condition offer yet", Created_Time: "2026-11-19T17:53:00-03:00", Created_By: { name: "João Amaral" } }];

const pw = await import("playwright");
const browser = await pw.chromium.launch();

async function abrir(deals, { module = "Potentials", id = "123", dealStatus = 200, coqlStatus = 200, putStatus = 200, w = 1280, keepStorage = null } = {}) {
    const ctx = keepStorage || await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    const st = { deals: JSON.parse(JSON.stringify(deals)), dealGets: [], coql: [], puts: [], notesGets: 0 };
    await page.route("**/crm/v8/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname.endsWith("/settings/modules")) return route.fulfill({ json: { modules: [{ api_name: "Deals", module_name: "Potentials" }, { api_name: "Leads", module_name: "Leads" }] } });
        if (/\/Notes$/.test(url.pathname)) { st.notesGets++; return route.fulfill({ json: { data: NOTAS, info: { more_records: false } } }); }
        if (url.pathname.endsWith("/coql")) {
            st.coql.push(JSON.parse(req.postData()).select_query);
            if (coqlStatus !== 200) return route.fulfill({ status: coqlStatus, json: { code: "NO_PERMISSION", message: "permission denied" } });
            return route.fulfill({ json: { data: [{ "COUNT(id)": 2 }], info: { count: 1 } } });
        }
        const dm = url.pathname.match(/\/Deals\/(\d+)$/);
        if (dm && req.method() === "GET") {
            st.dealGets.push(url.searchParams.get("fields"));
            if (dealStatus !== 200) return route.fulfill({ status: dealStatus, json: { code: "NO_PERMISSION", message: "permission denied" } });
            return route.fulfill({ json: { data: [st.deals[dm[1]]] } });
        }
        if (dm && req.method() === "PUT") {
            const body = JSON.parse(req.postData());
            st.puts.push(body);
            if (putStatus !== 200) return route.fulfill({ status: putStatus, json: { data: [{ code: "INVALID_DATA", message: "invalid data", status: "error" }] } });
            Object.assign(st.deals[dm[1]], body.data[0]);
            return route.fulfill({ json: { data: [{ code: "SUCCESS", details: { id: dm[1] }, status: "success" }] } });
        }
        if (url.pathname.endsWith("/users")) return route.fulfill({ json: { users: [] } });
        return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(`${BASE}/crm/org1/tab/${module}/${id}`);
    await page.evaluate(() => SQNotesPanel.tick());
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-note");
    return { page, st, ctx };
}
const txt = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const umaLinha = (page) => page.evaluate(() => {
    const head = document.querySelector(".sqn-head"), pr = head.getBoundingClientRect();
    const kids = [...head.children].filter((k) => k.offsetParent);
    const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2));
    const fora = kids.filter((k) => k.getBoundingClientRect().right > pr.right + 0.5).map((k) => k.className);
    return { centros: [...new Set(tops)], altura: pr.height, fora, close: !!document.querySelector('.sqn-head [title="Recolher painel de notas"]').offsetParent };
});

// ---- deal de exemplo (Sonia) ----
{
    const { page, st, ctx } = await abrir({ 123: SONIA });
    await page.waitForSelector(".sqn-pill");
    ok(st.dealGets.length === 1 && st.coql.length === 1, "UMA leitura do Deal + UMA COQL", JSON.stringify({ g: st.dealGets.length, c: st.coql.length }));
    ok(["Owner", "Submitted_by", "Stage", "Formula_19", "Sales_person1", "Student_Consultant", "Contact_Pipeline", "Days_on_This_stage", "DSA", "Speaking", "All_Conditions_Met", "Number_7", "Important_Notes1", "Contact_Name"].every((f) => st.dealGets[0].split(",").includes(f)), "fields= pede os 14 campos da spec", st.dealGets[0]);
    ok(st.coql[0] === "select COUNT(id) from Deals where Contact_Name = '999'", "COQL conta Deals do mesmo contato", st.coql[0]);
    const pills = await txt(page, ".sqn-pill");
    ok(pills.join("|") === "DSANo|Speaking5|Qnt. Deals2|Requested0d", "selos: DSA No, Speaking 5, Qnt. Deals 2, Requested 0d", pills.join("|"));
    const dsaBg = await page.$eval(".sqn-pill-dsa", (e) => getComputedStyle(e).backgroundColor);
    ok(dsaBg === "rgb(103, 196, 128)", "DSA No verde #67c480", dsaBg);
    const labels = await txt(page, ".sqn-cell-label");
    ok(labels.join("|") === "Deal owner|Submitted by|Stage|Student rep|Student consultant|Assessment tracker", "rotulos da grade 2x3", labels.join("|"));
    const vals = await txt(page, ".sqn-cell-value");
    ok(vals.join("|") === "Marcos Henrique|Joao Amaral|Conditional offer1d|Adriana Lioni|Isabela Freitas|Need to Schedule Assessments1d", "valores da grade", vals.join("|"));
    ok((await page.$$(".sqn-days-ok")).length === 2, "selos de 1d verdes");
    const cols = await page.$$eval(".sqn-cell", (cs) => [...new Set(cs.map((c) => Math.round(c.getBoundingClientRect().top)))].length);
    ok(cols === 2, "grade com 2 linhas", String(cols));
    ok((await page.textContent(".sqn-imp-text")).includes("LCAE") && (await page.textContent(".sqn-imp-text")).includes("LCCA"), "Important notes aberta com o texto LCAE / LCCA");
    const ordem = await page.evaluate(() => { const p = document.querySelector(".sqn-panel"); return [".sqn-head", ".sqn-deal", ".sqn-list"].map((s) => [...p.children].indexOf(p.querySelector(s))); });
    ok(ordem[0] < ordem[1] && ordem[1] < ordem[2], "ordem: cabecalho, deal, lista de notas", ordem.join(","));
    const bg = await page.$eval(".sqn-deal", (e) => getComputedStyle(e).backgroundColor);
    ok(bg === "rgb(255, 255, 255)", "fundo branco", bg);
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/01-aberto-448.png` });

    // uma linha em todas as larguras, ate a minima (288px do drag.js)
    for (const pw_ of [760, 600, 448, 400, 340, 288, -448, -288]) {
        // negativo = painel solto (as duas setas ← → aparecem: um botao a mais na linha)
        await page.evaluate((w) => { document.querySelector(".sqn-panel").style.width = Math.abs(w) + "px";
            document.querySelectorAll('.sqn-head .sqn-icon-btn').forEach((b) => { if (w < 0) b.hidden = false; }); }, pw_);
        await page.waitForTimeout(50);
        const r = await umaLinha(page);
        ok(r.centros.length === 1 && !r.fora.length && r.close, `linha de selos em UMA linha, botao fechar visivel, painel ${pw_}px`, JSON.stringify(r));
        const pr = await page.evaluate(() => {
            const box = document.querySelector(".sqn-badges").getBoundingClientRect();
            return [...document.querySelectorAll(".sqn-pill")].map((p) => {
                const r = p.getBoundingClientRect(), v = p.querySelector(".sqn-pill-value"), n = p.querySelector(".sqn-pill-num");
                return { c: p.className.split(" ")[1], dentro: r.width > 0 && r.right <= box.right + 0.5, valorInteiro: !v || v.scrollWidth <= v.clientWidth + 0.5,
                    dias: !n || n.getBoundingClientRect().right <= r.right + 0.5 };
            });
        });
        // na largura padrao (448) e acima, nada corta; abaixo, so o valor do All Conditions pode cortar
        const ruins = pr.filter((x) => !x.dentro || !x.dias || (!x.valorInteiro && (x.c !== "sqn-pill-acm" || pw_ >= 448)));
        ok(pr.length === 4 && !ruins.length, `os 4 selos visiveis e legiveis (so o valor do All Conditions corta) em ${pw_}px`, JSON.stringify(ruins.length ? ruins : pr));
        const badgeOk = await page.$$eval(".sqn-cell", (cs) => cs.every((c) => { const b = c.querySelector(".sqn-days"); return !b || b.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5; }));
        ok(badgeOk, `selo de dias visivel dentro da celula em ${pw_}px`);
        if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/02-largura-${pw_}.png` });
    }
    await page.evaluate(() => { document.querySelector(".sqn-panel").style.width = ""; });

    // abrir/fechar lembrado
    await page.click(".sqn-imp-hide");
    ok(await page.$(".sqn-imp-text") === null && (await page.textContent(".sqn-imp-hide")).includes("show"), "hide fecha: so a barra fica, botao vira show");
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/03-fechado.png` });
    await page.click(".sqn-imp-title");
    ok(await page.$(".sqn-imp-text") !== null, "clicar na barra do titulo abre de novo");
    await page.click(".sqn-imp-hide");
    await page.reload();
    await page.evaluate(() => SQNotesPanel.tick());
    if (await page.isHidden(".sqn-panel")) await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-imp");
    ok(await page.$(".sqn-imp-text") === null, "fechado continua fechado depois de recarregar (localStorage)");
    await page.click(".sqn-imp-hide");

    // editar: cancelar restaura, salvar grava e recarrega
    await page.click(".sqn-imp-edit");
    ok(await page.isVisible(".sqn-imp-input") && await page.isVisible(".sqn-imp-save") && await page.isVisible(".sqn-imp-cancel"), "Edit abre textarea com Cancel/Save");
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/04-editando.png` });
    await page.fill(".sqn-imp-input", "descartar");
    await page.click(".sqn-imp-cancel");
    ok((await page.textContent(".sqn-imp-text")).includes("LCAE") && st.puts.length === 0, "Cancel restaura o texto e nao grava");
    const gets0 = st.dealGets.length;
    await page.click(".sqn-imp-edit");
    await page.fill(".sqn-imp-input", "Nova nota importante");
    await page.click(".sqn-imp-save");
    await page.waitForSelector(".sqn-imp-ok");
    ok(JSON.stringify(st.puts[0]) === JSON.stringify({ data: [{ Important_Notes1: "Nova nota importante" }] }), "Save faz PUT Deals/{id} com Important_Notes1", JSON.stringify(st.puts[0]));
    await page.waitForFunction((n) => true, gets0);
    await page.waitForTimeout(200);
    ok(st.dealGets.length === gets0 + 1 && (await page.textContent(".sqn-imp-text")) === "Nova nota importante", "depois de salvar, o painel le de novo do Zoho", `${gets0}->${st.dealGets.length}`);
    await page.close();
    await ctx.close();
}

// ---- erro no PUT: texto fica ----
{
    const { page, st, ctx } = await abrir({ 123: SONIA }, { putStatus: 400 });
    await page.waitForSelector(".sqn-imp-edit");
    await page.click(".sqn-imp-edit");
    await page.fill(".sqn-imp-input", "texto que nao pode sumir");
    await page.click(".sqn-imp-save");
    await page.waitForSelector(".sqn-imp-err");
    ok((await page.inputValue(".sqn-imp-input")) === "texto que nao pode sumir" && (await page.textContent(".sqn-imp-err")).includes("invalid data"), "Zoho recusa: erro com o motivo e o texto continua no campo");
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/05-erro-salvar.png` });
    await page.close(); await ctx.close();
}

// ---- campos vazios ----
{
    const { page, st, ctx } = await abrir({ 123: VAZIO });
    await page.waitForSelector(".sqn-cell");
    ok((await page.$$(".sqn-pill")).length === 0, "sem dados: nenhum selo (DSA vazio some)");
    ok((await txt(page, ".sqn-cell-text")).every((t) => t === "-") && (await page.$$(".sqn-days")).length === 0, "campo vazio mostra '-' e sem selo de dias");
    ok(st.coql.length === 0, "sem contato: nao faz COQL");
    ok(await page.isVisible(".sqn-imp-add") && await page.$(".sqn-imp") === null, "Important vazio: so o link '+ Add important note'");
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/06-vazio.png` });
    await page.click(".sqn-imp-add");
    ok(await page.isVisible(".sqn-imp-input"), "+ Add important note abre o mesmo editor");
    await page.fill(".sqn-imp-input", "primeira");
    await page.click(".sqn-imp-save");
    await page.waitForSelector(".sqn-imp-text");
    ok(st.puts[0]?.data?.[0]?.Important_Notes1 === "primeira" && (await page.textContent(".sqn-imp-text")) === "primeira", "nota importante criada aparece aberta");
    await page.close(); await ctx.close();
}

// ---- stage longo, cores de dias, HTML no texto ----
{
    const longo = { ...SONIA, Stage: "Unconditional offer accepted awaiting CAS and visa documents from the student", Formula_19: 15, Days_on_This_stage: 7, Number_7: 21, DSA: "Yes",
        Important_Notes1: '<img src=x onerror="window.__xss=1">texto' };
    const { page, ctx } = await abrir({ 123: longo }, { coqlStatus: 403 });
    await page.waitForSelector(".sqn-cell");
    const st0 = await page.$eval(".sqn-cell:nth-child(3)", (c) => { const t = c.querySelector(".sqn-cell-text"), b = c.querySelector(".sqn-days");
        return { trunc: t.scrollWidth > t.clientWidth, title: t.title, bIn: b.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5, cls: b.className }; });
    ok(st0.trunc && st0.title === longo.Stage && st0.bIn, "stage longo: corta com ..., tooltip com o valor inteiro, selo de dias visivel", JSON.stringify(st0));
    ok(st0.cls.includes("sqn-days-late"), "15 dias = vermelho", st0.cls);
    ok((await page.getAttribute(".sqn-cell:nth-child(6) .sqn-days", "class")).includes("sqn-days-warn"), "7 dias = ambar");
    ok((await page.$eval(".sqn-pill-dsa", (e) => getComputedStyle(e).backgroundColor)) === "rgb(240, 10, 48)", "DSA Yes vermelho #f00a30");
    ok((await txt(page, ".sqn-pill-deals")).join() === "Qnt. Deals2", "COQL recusada: Qnt. Deals cai para No. of apps");
    await page.waitForTimeout(100);
    ok(!(await page.evaluate(() => window.__xss)) && (await page.textContent(".sqn-imp-text")).includes("<img"), "HTML no Important notes aparece como texto, nao executa");
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/07-stage-longo.png` });
    await page.close(); await ctx.close();
}

// ---- Deal recusado: notas seguem ----
{
    const { page, ctx } = await abrir({ 123: SONIA }, { dealStatus: 403 });
    await page.waitForSelector(".sqn-deal-err");
    ok((await page.$$(".sqn-note")).length === 1 && (await page.textContent(".sqn-count")) === "1 nota", "sem permissao no Deal: notas carregam normalmente");
    ok((await page.textContent(".sqn-deal-err")).includes("unavailable"), "aviso curto no lugar da grade");
    if (SHOTS) await page.locator(".sqn-panel").screenshot({ path: `${SHOTS}/08-sem-permissao.png` });
    await page.close(); await ctx.close();
}

// ---- outro modulo, troca de deal e refresh ----
{
    const { page, st, ctx } = await abrir({ 123: SONIA }, { module: "Leads" });
    await page.waitForTimeout(150);
    ok(await page.isHidden(".sqn-deal") && (await page.$$(".sqn-pill")).length === 0 && st.dealGets.length === 0, "Lead: nada do Deal aparece nem e buscado");
    await page.close(); await ctx.close();
}
{
    const outro = { ...SONIA, id: "456", Owner: { name: "Outra Pessoa" }, DSA: "Yes" };
    const { page, st, ctx } = await abrir({ 123: SONIA, 456: outro });
    await page.waitForSelector(".sqn-pill");
    await page.evaluate(() => { history.pushState({}, "", "/crm/org1/tab/Potentials/456"); SQNotesPanel.tick(); });
    await page.waitForFunction(() => document.querySelector(".sqn-cell-text")?.textContent === "Outra Pessoa");
    ok(true, "trocar de deal recarrega o cabecalho com o deal novo");
    const n = st.dealGets.length;
    await page.click('[title="Recarregar notas"]');
    await page.waitForTimeout(200);
    ok(st.dealGets.length === n + 1, "botao ↻ le o Deal de novo", `${n}->${st.dealGets.length}`);
    await page.close(); await ctx.close();
}

await browser.close();
server.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou");
process.exit(falhas ? 1 : 0);
