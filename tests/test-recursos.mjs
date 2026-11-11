/**
 * test-recursos.mjs — recursos da 1.7.0 num Zoho de mentira.
 *
 *  1. #Campo: o texto da resposta troca #Nome_API pelo valor do registro aberto
 *     (lookup pelo nome, data local, lista, booleano), deixa hashtag que nao e
 *     campo como esta, nao troca nada fora de registro nem com a API falhando.
 *  2. Paineis arrastaveis: notas e respostas rapidas movem pelo cabecalho,
 *     ficam dentro da tela, lembram a posicao (inclusive apos recarregar) e o
 *     duplo clique volta ao padrao. A aba Notas acompanha o painel e, recolhida,
 *     arrasta na vertical sem abrir o painel.
 *  3. Fluxo ao recolher: painel aberto continua aberto apos recarregar e o
 *     rascunho volta.
 *  4. Popup: botao Copiar ao lado de Editar/Excluir copia o texto inteiro; o
 *     seletor de campos insere #Campo no cursor e explica quando nao ha registro.
 *
 * Roda: `node tests/test-recursos.mjs`.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cs = manifest.content_scripts[0];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

// Storage da extensao simulado sobre o localStorage da pagina: sobrevive ao reload.
const STORAGE_MOCK = `
window.chrome = { runtime: { id: "t", getURL: (p) => "/" + p, onMessage: { addListener() {} } },
  storage: { local: {
    get(keys) { const all = JSON.parse(localStorage.__sq || "{}"); const out = {}; [].concat(keys).forEach((k) => { if (k in all) out[k] = all[k]; }); return Promise.resolve(out); },
    set(items) { const all = JSON.parse(localStorage.__sq || "{}"); Object.assign(all, items); localStorage.__sq = JSON.stringify(all); window.__sets = (window.__sets || 0) + 1; return Promise.resolve(); }
  } } };`;

const editor = `<crux-note-editor id="editor" style="position:absolute;left:40px;top:40px;display:block;border:1px solid #ccc;padding:8px">
  <input class="cxNoteTitleInputElem" type="text"><div class="lyteEditorMainDiv" contenteditable="true" style="min-height:2em"></div>
  <div class="cxNotesFooterLeft" style="display:flex;min-height:32px"></div></crux-note-editor>`;
const page = (withContent) => `<!doctype html><html><head><meta charset="utf-8">${cs.css.map((f) => `<style>${read(f)}</style>`).join("")}</head>
<body style="margin:0"><script>${STORAGE_MOCK}</script>${withContent ? editor : ""}<div style="height:2000px">Deal</div>
${cs.js.filter((f) => withContent || f !== "content.js").map((f) => `<script>${read(f)}</script>`).join("\n")}</body></html>`;

const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    const file = path.join(ROOT, url);
    if (url !== "/" && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
        return res.end(fs.readFileSync(file));
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(url.includes("/com-editor/")));
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

const REGISTRO = { id: "123", Deal_Name: "Maria Silva", Stage: "Qualification", Owner: { name: "Mauro", id: "9", email: "m@x" },
    Closing_Date: "2026-12-01", Cursos: ["Inglês", "Visto"], Amount: 1500, Pago: true, Vazio: null };
const CAMPOS = [
    { api_name: "Deal_Name", field_label: "Deal Name", data_type: "text" },
    { api_name: "Stage", field_label: "Stage", data_type: "picklist" },
    { api_name: "Owner", field_label: "Deal Owner", data_type: "ownerlookup" },
    { api_name: "Closing_Date", field_label: "Closing Date", data_type: "date" },
    { api_name: "Docs", field_label: "Documentos", data_type: "subform" }
];

async function abrir(urlPath, { recordStatus = 200, ctx = null } = {}) {
    const context = ctx || await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await context.newPage();
    const estado = { recordGets: 0 };
    await p.route("**/crm/v*/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/settings/modules")) return route.fulfill({ json: { modules: [{ api_name: "Deals", module_name: "Potentials", singular_label: "Deal" }] } });
        if (url.pathname.endsWith("/settings/fields")) return route.fulfill({ json: { fields: CAMPOS } });
        if (url.pathname.endsWith("/Deals/123")) {
            estado.recordGets++;
            if (recordStatus !== 200) return route.fulfill({ status: recordStatus, json: {} });
            return route.fulfill({ json: { data: [REGISTRO] } });
        }
        if (url.pathname.endsWith("/Notes")) return route.fulfill({ status: 204, body: "" });
        return route.fulfill({ status: 204, body: "" });
    });
    await p.goto(BASE + urlPath);
    return { page: p, estado, context };
}

// ---------- 1. #Campo ----------
{
    const { page: p, estado, context } = await abrir("/crm/org1/tab/Potentials/123");
    const txt = "Oi #Deal_Name, etapa #Stage, dono #Owner, fecha #Closing_Date, cursos #Cursos, valor #Amount, pago #Pago, [#Vazio] #StudyQuest #1";
    const [titulo, corpo] = await p.evaluate((t) => Promise.all([SQPlaceholders.fill("Retorno #Deal_Name"), SQPlaceholders.fill(t)]), txt);
    ok(corpo === "Oi Maria Silva, etapa Qualification, dono Mauro, fecha 01/12/2026, cursos Inglês, Visto, valor 1500, pago Sim, [] #StudyQuest #1",
        "#Campo vira o valor do registro; hashtag que nao e campo fica", corpo);
    ok(titulo === "Retorno Maria Silva", "titulo do template tambem troca", titulo);
    ok(estado.recordGets === 1, "titulo + texto = uma leitura do registro", String(estado.recordGets));
    const semToken = await p.evaluate(() => SQPlaceholders.fill("Texto sem campo"));
    ok(semToken === "Texto sem campo" && estado.recordGets === 1, "texto sem # nao chama a API");

    const lista = await p.evaluate(() => SQPlaceholders.fields());
    ok(lista && lista.module === "Deal" && lista.fields.map((f) => f.api).join(",") === "Closing_Date,Deal_Name,Owner,Stage",
        "lista de campos por rotulo, sem subform", JSON.stringify(lista && lista.fields.map((f) => f.api)));
    ok(lista && lista.fields.find((f) => f.api === "Owner").value === "Mauro", "lista traz o valor deste registro");

    await p.evaluate(() => history.pushState({}, "", "/crm/org1/tab/Potentials/list"));
    const fora = await p.evaluate(() => SQPlaceholders.fill("Oi #Deal_Name"));
    ok(fora === "Oi #Deal_Name", "fora de registro, nada e trocado", fora);
    await context.close();

    const falha = await abrir("/crm/org1/tab/Potentials/123", { recordStatus: 500 });
    const r = await falha.page.evaluate(() => SQPlaceholders.fillAll(["Oi #Deal_Name"]));
    ok(r.texts[0] === "Oi #Deal_Name" && r.status === "erro" && r.error, "Zoho recusando o registro: texto como esta e o motivo vem junto", JSON.stringify(r));
    await falha.context.close();

    // campo do modulo que o Zoho omitiu da resposta (vazio no registro) vira texto vazio
    const omitido = await abrir("/crm/org1/tab/Potentials/123");
    await omitido.page.route("**/crm/v*/**/settings/fields*", (route) => route.fulfill({ json: { fields: CAMPOS.concat([{ api_name: "st_Bonus_Payment", field_label: "Bonus", data_type: "currency" }]) } }));
    const o = await omitido.page.evaluate(() => SQPlaceholders.fill("Bonus: [#st_Bonus_Payment] #Deal_Name"));
    ok(o === "Bonus: [] Maria Silva", "campo do modulo ausente na resposta do registro vira vazio, nao fica #", o);
    await omitido.context.close();
}

// ---------- 2 e 3. painel de notas arrastavel + fluxo ao recolher ----------
{
    const { page: p, context } = await abrir("/crm/org1/tab/Potentials/123");
    await p.evaluate(() => SQNotesPanel.tick());
    await p.click(".sqn-tab");
    await p.waitForSelector(".sqn-empty");
    const box = (s) => p.$eval(s, (e) => e.getBoundingClientRect().toJSON());
    const antes = await box(".sqn-panel");
    const head = await box(".sqn-head");
    await p.mouse.move(head.left + 40, head.top + 20);
    await p.mouse.down();
    await p.mouse.move(head.left - 300, head.top + 120, { steps: 6 });
    await p.mouse.up();
    const depois = await box(".sqn-panel");
    ok(Math.abs(depois.left - (antes.left - 340)) <= 2 && Math.abs(depois.top - (antes.top + 100)) <= 2 && depois.height <= 800 * 0.8 + 1, "painel de notas move pelo cabecalho (solto, ate 80% da altura)",
        `antes ${antes.left},${antes.top} depois ${depois.left},${depois.top}`);
    ok(depois.bottom <= 800 - 11, "altura ajustada para nao sair por baixo", JSON.stringify(depois));
    const aba = await box(".sqn-tab");
    ok(aba.right <= depois.left + 1 && Math.abs(aba.top - (depois.top + 16)) <= 2, "aba acompanha o painel arrastado, do lado de fora", JSON.stringify(aba));

    // arrastar para fora da tela: fica preso na borda
    const h2 = await box(".sqn-head");
    await p.mouse.move(h2.left + 40, h2.top + 20);
    await p.mouse.down();
    await p.mouse.move(-500, -500, { steps: 4 });
    await p.mouse.up();
    const preso = await box(".sqn-panel");
    ok(preso.left >= 12 && preso.top >= 12, "arrastar para fora da tela para na margem", JSON.stringify(preso));
    const abaPreso = await box(".sqn-tab");
    ok(abaPreso.left >= preso.right - 1 && abaPreso.right <= 1280, "sem espaco a esquerda, aba vai para o lado direito do painel", JSON.stringify(abaPreso));

    // rascunho + recolher
    await p.fill(".sqn-title-input", "Retorno");
    await p.fill(".sqn-input", "Ligar amanha");
    await p.click('.sqn-head [aria-label="Recolher painel de notas"]');
    ok(await p.isHidden(".sqn-panel"), "recolher esconde o painel");
    const abaRecolhida = await box(".sqn-tab");
    ok(Math.abs(abaRecolhida.right - 1280) <= 1, "recolhida, a aba volta para a borda direita", JSON.stringify(abaRecolhida));

    // aba recolhida arrasta na vertical e nao abre o painel
    await p.mouse.move(abaRecolhida.left + 10, abaRecolhida.top + 20);
    await p.mouse.down();
    await p.mouse.move(abaRecolhida.left + 10, abaRecolhida.top + 220, { steps: 6 });
    await p.mouse.up();
    const abaMovida = await box(".sqn-tab");
    ok(Math.abs(abaMovida.top - (abaRecolhida.top + 200)) <= 2 && await p.isHidden(".sqn-panel"), "aba recolhida arrasta na vertical sem abrir o painel", JSON.stringify(abaMovida));

    await p.click(".sqn-tab");
    const reaberto = await box(".sqn-panel");
    ok(Math.abs(reaberto.left - preso.left) <= 1 && Math.abs(reaberto.top - preso.top) <= 1, "reabrir volta onde a pessoa deixou", JSON.stringify(reaberto));
    ok((await p.textContent(".sqn-input")) === "Ligar amanha", "rascunho continua ao recolher e reabrir");

    // recarregar: aberto, mesma posicao, rascunho de volta
    await p.reload();
    await p.evaluate(() => SQNotesPanel.tick());
    await p.waitForSelector(".sqn-panel:not([hidden])", { timeout: 3000 }).catch(() => {});
    ok(await p.isVisible(".sqn-panel"), "recarregou com o painel aberto: continua aberto");
    await p.waitForTimeout(150);
    const recarregado = await box(".sqn-panel");
    ok(Math.abs(recarregado.left - preso.left) <= 1 && Math.abs(recarregado.top - preso.top) <= 1, "posicao lembrada apos recarregar", JSON.stringify(recarregado));
    ok((await p.textContent(".sqn-input")) === "Ligar amanha" && (await p.inputValue(".sqn-title-input")) === "Retorno", "rascunho volta apos recarregar");

    // duplo clique: volta ao padrao (encostado a direita, altura cheia)
    const h3 = await box(".sqn-head");
    await p.mouse.dblclick(h3.left + 60, h3.top + 20);
    const padrao = await box(".sqn-panel");
    ok(Math.abs(padrao.right - 1268) <= 2 && Math.abs(padrao.top - 12) <= 2 && Math.abs(padrao.bottom - 788) <= 2, "duplo clique volta ao lugar padrao", JSON.stringify(padrao));

    // janela encolhe: painel posicionado volta para dentro
    const h4 = await box(".sqn-head");
    await p.mouse.move(h4.left + 40, h4.top + 20);
    await p.mouse.down();
    await p.mouse.move(h4.left - 600, h4.top + 300, { steps: 4 });
    await p.mouse.up();
    await p.setViewportSize({ width: 700, height: 500 });
    await p.waitForTimeout(100);
    const encolhido = await box(".sqn-panel");
    ok(encolhido.left >= 0 && encolhido.right <= 700 && encolhido.top >= 0 && encolhido.bottom <= 500, "janela menor: painel continua inteiro na tela", JSON.stringify(encolhido));
    const sets = await p.evaluate(() => window.__sets || 0);
    ok(sets <= 4, "arrastar grava no storage so ao soltar (nao a cada movimento)", String(sets));
    await context.close();
}

// ---------- 2. painel de respostas rapidas arrastavel ----------
{
    const { page: p, context } = await abrir("/com-editor/crm/org1/tab/Potentials/123");
    await p.evaluate(() => {
        window.fetch = ((orig) => (url, o) => String(url).includes("/replies")
            ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: "1", title: "Oi", text: "Olá #Deal_Name", category: "Geral" }]), text: () => Promise.resolve("") })
            : orig(url, o))(window.fetch);
    });
    await p.waitForSelector(".quick-replies-btn", { timeout: 8000 });
    await p.click(".quick-replies-btn");
    await p.waitForSelector(".quick-reply-item");
    await p.waitForTimeout(300); // fim da animacao de entrada
    const box = (s) => p.$eval(s, (e) => e.getBoundingClientRect().toJSON());
    const a = await box(".quick-replies-panel");
    const h = await box(".quick-replies-header");
    await p.mouse.move(h.left + 30, h.top + 15);
    await p.mouse.down();
    await p.mouse.move(h.left + 530, h.top + 215, { steps: 6 });
    await p.mouse.up();
    const b = await box(".quick-replies-panel");
    ok(Math.abs(b.left - (a.left + 500)) <= 2 && Math.abs(b.top - (a.top + 200)) <= 2, "painel de respostas move pelo cabecalho", `${a.left},${a.top} -> ${b.left},${b.top}`);
    ok(await p.isVisible(".quick-replies-panel"), "soltar o arraste nao fecha o painel");
    await p.keyboard.press("Escape");
    await p.click(".quick-replies-btn");
    await p.waitForSelector(".quick-reply-item");
    await p.waitForTimeout(300);
    const c = await box(".quick-replies-panel");
    ok(Math.abs(c.left - b.left) <= 1 && Math.abs(c.top - b.top) <= 1, "reabrir lembra a posicao arrastada", JSON.stringify(c));

    await p.waitForFunction(() => document.querySelector(".quick-reply-text").textContent === "Olá Maria Silva", null, { timeout: 3000 }).catch(() => {});
    ok((await p.textContent(".quick-reply-text")) === "Olá Maria Silva", "lista do painel no Zoho mostra a resposta ja com os dados do Deal", await p.textContent(".quick-reply-text"));

    // inserir com #Campo: chega trocado no editor do Zoho
    await p.click(".quick-reply-item");
    await p.waitForFunction(() => document.querySelector(".lyteEditorMainDiv").textContent.includes("Olá"));
    const inserido = await p.textContent(".lyteEditorMainDiv");
    ok(inserido.includes("Olá Maria Silva"), "template inserido no editor do Zoho ja com o valor do campo", inserido);
    await context.close();
}

// ---------- inserir com o Zoho recusando o registro: avisa na tela ----------
{
    const { page: p, context } = await abrir("/com-editor/crm/org1/tab/Potentials/123", { recordStatus: 401 });
    await p.evaluate(() => {
        window.fetch = ((orig) => (url, o) => String(url).includes("/replies")
            ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: "1", title: "Oi", text: "Olá #Deal_Name", category: "Geral" }]), text: () => Promise.resolve("") })
            : orig(url, o))(window.fetch);
    });
    await p.waitForSelector(".quick-replies-btn", { timeout: 8000 });
    await p.click(".quick-replies-btn");
    await p.waitForSelector(".quick-reply-item");
    await p.click(".quick-reply-item");
    const aviso = await p.waitForSelector(".quick-replies-notification.error", { timeout: 3000 }).then((e) => e.textContent()).catch(() => "");
    ok(aviso.includes("não foram preenchidos"), "falha ao ler o registro aparece na tela ao inserir", aviso);
    await context.close();
}

// ---------- 4. popup: Copiar + seletor de campos ----------
{
    const context = await browser.newContext({ viewport: { width: 400, height: 700 }, permissions: ["clipboard-read", "clipboard-write"] });
    const p = await context.newPage();
    await p.addInitScript(() => {
        const replies = [{ id: "1", title: "Lead Handover", text: "Linha 1\nLinha 2 com #Deal_Name", category: "Sales", author: "Carina" }];
        window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(replies), text: () => Promise.resolve(JSON.stringify(replies)) });
        const fields = { module: "Deal", fields: [{ api: "Deal_Name", label: "Deal Name", value: "Maria Silva" }, { api: "Stage", label: "Stage", value: "" }] };
        window.chrome = {
            runtime: { id: "t", getURL: (x) => x },
            storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
            tabs: {
                query: () => Promise.resolve([{ id: 1, url: window.__tabUrl || "https://crm.zoho.com/crm/org1/tab/Potentials/123" }]),
                sendMessage: (id, m) => Promise.resolve(m.action === "recordFields" ? (window.__semRegistro ? null : fields)
                    : m.action === "fillText" ? (window.__semRegistro ? { status: "sem-registro", texts: m.texts } : { status: "ok", texts: m.texts.map((t) => t.replace("#Deal_Name", "Maria Silva")) })
                    : null)
            }
        };
    });
    await p.goto(BASE + "/popup.html");
    await p.waitForSelector(".reply-item");
    const ordem = await p.$$eval(".reply-actions button", (bs) => bs.map((b) => b.textContent));
    ok(ordem.join(",") === "Copiar,Editar,Excluir", "Copiar ao lado de Editar e Excluir", ordem.join(","));
    await p.click(".btn-copy");
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok(clip === "Linha 1\nLinha 2 com Maria Silva", "copia o texto inteiro ja com os dados do deal", JSON.stringify(clip));
    await p.waitForFunction(() => document.querySelector(".btn-copy").textContent === "Copiado");
    ok(true, "botao confirma que copiou");
    await p.waitForTimeout(1700);
    ok((await p.textContent(".btn-copy")) === "Copiar", "rotulo volta depois de 1,5s");
    await p.evaluate(() => { window.__semRegistro = true; });
    await p.click(".btn-copy");
    await p.waitForFunction(() => document.querySelector(".btn-copy").textContent === "Copiado");
    const clipCru = await p.evaluate(() => navigator.clipboard.readText());
    const alerta = await p.textContent("#alert");
    ok(clipCru.includes("#Deal_Name") && alerta.includes("Abra um Deal"), "sem deal aberto: copia como esta e avisa por que", alerta);
    await p.evaluate(() => { window.__semRegistro = false; });

    await p.fill("#replyText", "Oi, tudo bem?");
    await p.$eval("#replyText", (t) => t.setSelectionRange(3, 3));
    await p.click("#btnFields");
    await p.waitForSelector(".field-item");
    ok((await p.$$(".field-item")).length === 2, "seletor lista os campos do registro");
    ok((await p.textContent("#fieldPickerStatus")).includes("Deal"), "seletor diz de qual modulo sao os campos");
    await p.fill("#fieldSearch", "stage");
    ok((await p.$$(".field-item")).length === 1 && (await p.textContent(".field-item-value")) === "(vazio neste registro)", "busca filtra e campo vazio e explicado");
    await p.fill("#fieldSearch", "zzz");
    ok((await p.textContent("#fieldPickerStatus")).includes("Limpe a busca"), "busca sem resultado orienta");
    await p.fill("#fieldSearch", "");
    await p.click('.field-item:has-text("Deal Name")');
    ok((await p.inputValue("#replyText")) === "Oi, #Deal_Name tudo bem?", "campo entra no cursor do Texto da Resposta", await p.inputValue("#replyText"));

    // autocompletar: digitar # sugere os campos
    await p.fill("#replyText", "");
    await p.click("#replyText");
    await p.keyboard.type("Oi #st");
    await p.waitForSelector("#fieldSuggest:not(.is-hidden) .suggest-item");
    const sug = await p.$$eval(".suggest-item code", (cs) => cs.map((c) => c.textContent));
    ok(sug[0] === "#Stage", "digitar #st sugere Stage primeiro", sug.join(","));
    await p.keyboard.press("Enter");
    ok((await p.inputValue("#replyText")) === "Oi #Stage ", "Enter completa o campo e poe espaco", JSON.stringify(await p.inputValue("#replyText")));
    ok(await p.isHidden("#fieldSuggest"), "lista fecha depois de escolher");
    await p.keyboard.type("e #");
    await p.waitForSelector("#fieldSuggest:not(.is-hidden) .suggest-item");
    ok((await p.$$(".suggest-item")).length === 2, "# sozinho mostra todos os campos");
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Tab");
    ok((await p.inputValue("#replyText")) === "Oi #Stage e #Stage ", "seta para baixo + Tab escolhe o segundo", JSON.stringify(await p.inputValue("#replyText")));
    await p.keyboard.type("#de");
    await p.waitForSelector("#fieldSuggest:not(.is-hidden) .suggest-item");
    await p.click('.suggest-item:has-text("Deal Name")');
    ok((await p.inputValue("#replyText")).endsWith("#Deal_Name "), "clique escolhe o campo", JSON.stringify(await p.inputValue("#replyText")));
    await p.keyboard.type("#zzz");
    await p.waitForSelector("#fieldSuggest:not(.is-hidden) .suggest-empty");
    ok((await p.textContent(".suggest-empty")).includes("Nenhum campo"), "sem resultado, a lista diz isso");
    await p.keyboard.press("Escape");
    ok(await p.isHidden("#fieldSuggest"), "Esc fecha a lista");
    await p.fill("#replyText", "email@#");
    await p.waitForTimeout(100);
    ok(await p.isHidden("#fieldSuggest"), "# colado em palavra (e-mail) nao abre a lista");
    await context.close();

    const ctx2 = await browser.newContext({ viewport: { width: 400, height: 700 } });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => {
        window.__semRegistro = true;
        window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve("[]") });
        window.chrome = { runtime: { id: "t" }, storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
            tabs: { query: () => Promise.resolve([{ id: 1, url: "https://crm.zoho.com/crm/org1/tab/Potentials/list" }]), sendMessage: () => Promise.resolve(null) } };
    });
    await p2.goto(BASE + "/popup.html");
    await p2.click("#btnFields");
    await p2.waitForFunction(() => document.getElementById("fieldPickerStatus").textContent.includes("Abra um registro"));
    ok(true, "sem registro aberto, o seletor explica o que fazer");
    await p2.click("#replyText");
    await p2.keyboard.type("#de");
    await p2.waitForSelector("#fieldSuggest:not(.is-hidden) .suggest-empty");
    ok((await p2.textContent(".suggest-empty")).includes("Abra um registro"), "autocompletar sem registro e sem cache explica o que fazer");
    await ctx2.close();

    // popup aberto fora do registro: usa a ultima lista de campos vista
    const ctx3 = await browser.newContext({ viewport: { width: 400, height: 700 } });
    const p3 = await ctx3.newPage();
    await p3.addInitScript(() => {
        window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve("[]") });
        const cache = { sqFieldsCache: { module: "Deal", fields: [{ api: "Deal_Name", label: "Deal Name" }] } };
        window.chrome = { runtime: { id: "t" }, storage: { local: { get: () => Promise.resolve(cache), set: () => Promise.resolve() } },
            tabs: { query: () => Promise.resolve([{ id: 1, url: "https://mail.google.com/" }]), sendMessage: () => Promise.resolve(null) } };
    });
    await p3.goto(BASE + "/popup.html");
    await p3.click("#replyText");
    await p3.keyboard.type("#de");
    await p3.waitForSelector("#fieldSuggest:not(.is-hidden) .suggest-item");
    await p3.keyboard.press("Enter");
    ok((await p3.inputValue("#replyText")) === "#Deal_Name ", "fora do Zoho, o autocompletar usa a ultima lista de campos", JSON.stringify(await p3.inputValue("#replyText")));
    await ctx3.close();
}

await browser.close();
server.close();
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou");
process.exit(falhas ? 1 : 0);
