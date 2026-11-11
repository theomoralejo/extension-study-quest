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
    const estado = { notas: notas.slice(), posts: [], puts: [], dels: [], gets: [], xss: false };
    await page.exposeFunction("__xss", () => { estado.xss = true; });
    await page.route("**/crm/v8/**", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname.endsWith("/settings/modules")) {
            return route.fulfill({ json: { modules: [{ api_name: "Deals", module_name: "Potentials" }] } });
        }
        const um = url.pathname.match(/\/Notes\/(\w+)$/);
        if (um && req.method() === "PUT") {
            const body = JSON.parse(req.postData());
            estado.puts.push({ id: um[1], body });
            const n = estado.notas.find((x) => x.id === um[1]);
            Object.assign(n, body.data[0]);
            return route.fulfill({ json: { data: [{ code: "SUCCESS", details: { id: um[1] }, status: "success" }] } });
        }
        if (um && req.method() === "DELETE") {
            estado.dels.push(um[1]);
            estado.notas = estado.notas.filter((x) => x.id !== um[1]);
            return route.fulfill({ json: { data: [{ code: "SUCCESS", details: { id: um[1] }, status: "success" }] } });
        }
        if (url.pathname.endsWith("/Deals/123/Notes") && req.method() === "GET") {
            estado.gets.push(url.searchParams.get("fields"));
            if (!estado.notas.length) return route.fulfill({ status: 204, body: "" });
            return route.fulfill({ json: { data: estado.notas, info: { more_records: false } } });
        }
        if (url.pathname.endsWith("/Deals/123/Notes") && req.method() === "POST") {
            const body = JSON.parse(req.postData());
            estado.posts.push(body);
            if (postStatus !== 201) return route.fulfill({ status: postStatus, json: { data: [{ code: "MANDATORY_NOT_FOUND", message: "required field not found", status: "error" }] } });
            estado.notas.push({ id: "n" + estado.posts.length, Note_Content: body.data[0].Note_Content, Note_Title: body.data[0].Note_Title, $is_shared_to_client: !!body.data[0].$is_shared_to_client, Created_Time: "2026-11-06T16:0" + estado.posts.length + ":00-03:00", Created_By: { name: "Mauro" } });
            return route.fulfill({ status: 201, json: { data: [{ code: "SUCCESS", details: { id: "n9" }, status: "success" }] } });
        }
        if (url.pathname.endsWith("/users")) {
            estado.users = (estado.users || 0) + 1;
            return route.fulfill({ json: { users: [{ id: "77", full_name: "Mauro Silva" }, { id: "78", full_name: "Ana" }] } });
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
    const corpo = await page.$eval(".sqn-note .sqn-body", (e) => e.innerText);
    ok(corpo.includes("Linha 1\nLinha 2") && !corpo.includes("<"), "HTML da nota mostra a quebra de linha, sem tag aparecendo", JSON.stringify(corpo));
    await page.waitForTimeout(200);
    ok(!estado.xss && (await page.$$(".sqn-list img")).length === 0, "HTML da nota nao executa nem injeta elemento");

    // O Zoho tem raiz menor e estilo proprio em button/textarea: o painel nao pode herdar nada disso.
    const fs = await page.evaluate(() => ["sqn-panel", "sqn-body", "sqn-input", "sqn-send"].map((c) => parseFloat(getComputedStyle(document.querySelector("." + c)).fontSize)));
    ok(fs[0] === 16 && fs[1] === 16 && fs[2] === 16 && fs[3] === 15, "tamanho de fonte independe da raiz e do CSS do Zoho (16/16/16/15px)", fs.join("/"));
    const tabR = await page.$eval(".sqn-tab", (e) => e.getBoundingClientRect().right);
    const panL = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect().left);
    ok(tabR <= panL + 1, "aba aberta fica encostada fora do painel, sem cobrir", `aba.right=${tabR} painel.left=${panL}`);

    // ---- gravar ----
    ok(await page.isVisible(".sqn-title-input"), "campo Titulo sempre visivel no painel");
    ok(await page.isDisabled(".sqn-send"), "botao desabilitado com campo vazio");
    await page.fill(".sqn-input", "Aluno confirmou janeiro");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 3);
    const p = estado.posts[0]?.data?.[0];
    ok(p && p.Note_Content === "Aluno confirmou janeiro" && p.Parent_Id?.id === "123" && p.Parent_Id?.module?.api_name === "Deals",
        "POST com Note_Content e Parent_Id {module.api_name: Deals, id}", JSON.stringify(estado.posts[0]));
    ok((await page.textContent(".sqn-input")) === "", "campo limpa depois de salvar");
    ok(await page.isVisible(".sqn-status") && (await page.textContent(".sqn-status")).includes("Recarregar página"),
        "depois de salvar, aviso explica que a lista do Zoho na pagina so atualiza recarregando");
    ok(estado.gets[0] && estado.gets[0].includes("$is_shared_to_client"), "GET pede $is_shared_to_client", estado.gets[0]);
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
    ok((await page.textContent(".sqn-input")) === "Antes Oi! Faltam os documentos.", "template entra no campo, no cursor", await page.textContent(".sqn-input"));
    ok((await page.inputValue(".sqn-title-input")) === "Cobro docs", "titulo do template preenche o campo Titulo");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 3);
    ok(estado.posts[0]?.data?.[0]?.Note_Title === "Cobro docs", "nota sai com Note_Title do template", JSON.stringify(estado.posts[0]));
    ok((await page.inputValue(".sqn-title-input")) === "", "campo Titulo limpa depois de salvar");
    // titulo digitado a mao tambem vai como Note_Title
    await page.fill(".sqn-title-input", "Ligação");
    await page.fill(".sqn-input", "Conversamos sobre janeiro");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 4);
    ok(estado.posts[1]?.data?.[0]?.Note_Title === "Ligação", "titulo digitado vai como Note_Title", JSON.stringify(estado.posts[1]));
    await page.close();
}

// ---- texto rico, compartilhar com o cliente, editar e excluir ----
{
    const RICAS = [
        { id: "r1", Note_Title: "Rica", Note_Content: '<b>forte</b> <span style="color: rgb(233, 83, 32)">cor</span> <a href="javascript:__xss()">mau</a> <a href="https://studyquest.co.uk">bom</a><script>__xss()</script><ul><li>item</li></ul>', $is_shared_to_client: true, Created_Time: "2026-11-02T09:00:00-03:00", Created_By: { name: "Ana" } },
        { id: "r2", Note_Content: "Sem permissao", $editable: false, Created_Time: "2026-11-01T09:00:00-03:00", Created_By: { name: "Carina" } }
    ];
    const { page, estado } = await abrir(RICAS);
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-note");
    const rica = page.locator(".sqn-note", { hasText: "Rica" });
    ok(await rica.locator(".sqn-body b").count() === 1 && await rica.locator(".sqn-body li").count() === 1, "nota com formatacao aparece formatada (negrito, lista)");
    ok((await rica.locator(".sqn-body span").getAttribute("style") || "").includes("color"), "cor do texto da nota e mantida");
    const hrefs = await rica.locator(".sqn-body a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    ok(hrefs.join(",") === ",https://studyquest.co.uk" || (hrefs[0] === null && hrefs[1] === "https://studyquest.co.uk"), "link javascript: perde o href; https fica", JSON.stringify(hrefs));
    await page.waitForTimeout(200);
    ok(!estado.xss && await rica.locator("script").count() === 0, "script de nota nao entra nem executa");
    ok(await rica.locator(".sqn-meta .sqn-badge").isVisible(), "nota do portal do cliente mostra o selo no cabecalho do cartao");
    const semPerm = page.locator(".sqn-note", { hasText: "Sem permissao" });
    ok(await semPerm.locator("button").count() === 0, "nota com $editable false nao oferece Editar/Excluir");

    // barra de formatacao no estilo do Zoho
    const titulos = await page.$$eval(".sqn-toolbar .sqn-tool", (bs) => bs.map((b) => b.title));
    const esperado = ["Negrito", "Itálico", "Sublinhado", "Tachado", "Cor do texto", "Cor de fundo", "Lista com marcadores", "Lista numerada", "Inserir link", "Aumentar recuo", "Diminuir recuo", "Subscrito", "Sobrescrito", "Emoji", "Limpar formatação"];
    const faltam = esperado.filter((t) => !titulos.some((x) => x.startsWith(t)));
    ok(!faltam.length, "barra tem as 15 ferramentas do editor do Zoho", "faltam: " + faltam.join(", "));

    // negrito vai como HTML; compartilhar vai como $is_shared_to_client
    await page.click(".sqn-input");
    await page.keyboard.type("normal ");
    await page.click('.sqn-tool[title^="Negrito"]');
    ok((await page.getAttribute('.sqn-tool[title^="Negrito"]', "aria-pressed")) === "true", "botao Negrito fica marcado enquanto ativo");
    await page.keyboard.type("forte");
    await page.check(".sqn-share input");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 3);
    const p = estado.posts[0]?.data?.[0] || {};
    ok(/<b>forte<\/b>/.test(p.Note_Content || ""), "texto em negrito sai como HTML no Note_Content", p.Note_Content);
    ok(p.$is_shared_to_client === true, "marcar 'Compartilhar com o cliente' envia $is_shared_to_client true", JSON.stringify(p));
    ok(!(await page.isChecked(".sqn-share input")), "caixa de compartilhar desmarca depois de salvar");

    // texto sem formatacao continua saindo como texto puro
    await page.click(".sqn-input");
    await page.keyboard.type("linha 1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("linha 2");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-note").length === 4);
    const p2 = estado.posts[1]?.data?.[0] || {};
    ok(p2.Note_Content === "linha 1\nlinha 2" && !("$is_shared_to_client" in p2), "texto sem formatacao sai puro, com quebra de linha, sem compartilhar", JSON.stringify(p2));

    // editar
    await rica.locator("button", { hasText: "Editar" }).click();
    ok((await page.inputValue(".sqn-title-input")) === "Rica" && (await page.textContent(".sqn-send")) === "Salvar alteração", "Editar carrega titulo e texto no editor");
    ok(await page.isChecked(".sqn-share input"), "Editar traz o estado de compartilhamento da nota");
    ok(await page.$$eval(".sqn-input script, .sqn-input img", (x) => x.length) === 0, "editor recebe a nota ja limpa");
    await page.fill(".sqn-title-input", "Rica editada");
    await page.uncheck(".sqn-share input");
    await page.click(".sqn-send");
    await page.waitForFunction(() => document.querySelector(".sqn-send").textContent === "Adicionar nota" && !document.querySelector(".sqn-send").dataset.busy?.includes("1"));
    const put = estado.puts[0];
    ok(put && put.id === "r1" && put.body.data[0].Note_Title === "Rica editada" && put.body.data[0].$is_shared_to_client === false,
        "Salvar alteracao faz PUT /Notes/{id} com titulo e compartilhamento novos", JSON.stringify(put));
    await page.waitForSelector(".sqn-note >> text=Rica editada");
    ok(true, "nota editada aparece na lista");

    // cancelar edicao devolve o rascunho
    await page.click(".sqn-input");
    await page.keyboard.type("rascunho");
    await page.locator(".sqn-note", { hasText: "Rica editada" }).locator("button", { hasText: "Editar" }).click();
    await page.click(".sqn-editbar button");
    ok((await page.textContent(".sqn-input")) === "rascunho", "Cancelar edicao devolve o rascunho que estava no campo", await page.textContent(".sqn-input"));

    // excluir com confirmacao
    const alvo = page.locator(".sqn-note", { hasText: "Rica editada" });
    await alvo.locator("button", { hasText: "Excluir" }).click();
    ok((await alvo.locator(".sqn-confirm-text").textContent()).includes("Rica editada"), "confirmacao de excluir diz qual nota some");
    ok(!estado.dels.length, "nada e excluido antes de confirmar");
    await alvo.locator("button", { hasText: "Cancelar" }).click();
    ok(!estado.dels.length && await alvo.locator("button", { hasText: "Editar" }).count() === 1, "Cancelar desiste sem excluir");
    await alvo.locator("button", { hasText: "Excluir" }).click();
    await alvo.locator("button", { hasText: "Excluir nota" }).click();
    await page.waitForFunction(() => !document.body.textContent.includes("Rica editada") || document.querySelectorAll(".sqn-note").length === 3);
    ok(estado.dels.join() === "r1", "Excluir nota faz DELETE /Notes/{id}", estado.dels.join());
    await page.close();
}

// ---- mencoes, selo do portal, setas de encostar e cantos de tamanho ----
{
    const MENC = [
        { id: "m1", Note_Content: "Falar com @Mauro Silva amanhã. Copiar contato@ana.com", $is_shared_to_client: true, Created_Time: "2026-11-03T09:00:00-03:00", Created_By: { name: "Ana" } },
        { id: "m2", Note_Content: 'Oi <a href="https://crm.zoho.com/crm/org1/settings/users/78">@Ana</a> e crm[user#77#5725767000000000001]crm', Created_Time: "2026-11-02T09:00:00-03:00", Created_By: { name: "Ana" } }
    ];
    const { page } = await abrir(MENC);
    await page.click(".sqn-tab");
    await page.waitForSelector(".sqn-note");
    await page.waitForFunction(() => document.querySelectorAll(".sqn-mention").length >= 3, null, { timeout: 3000 }).catch(() => {});
    const m = await page.$$eval(".sqn-mention", (els) => els.map((e) => [e.textContent, getComputedStyle(e).fontWeight, getComputedStyle(e).color, !!e.closest("a")]));
    ok(m.map((x) => x[0]).join("|") === "@Mauro Silva|@Ana|@Mauro Silva", "mencao vira @Nome (texto, link do Zoho e codigo crm[user#id])", JSON.stringify(m));
    ok(m.every((x) => Number(x[1]) >= 700 && x[2] === "rgb(0, 103, 166)" && !x[3]), "mencao em negrito, azul e sem link", JSON.stringify(m));
    const corpo1 = await page.locator(".sqn-note").first().locator(".sqn-body").textContent();
    ok(corpo1.includes("contato@ana.com") && (await page.locator(".sqn-note").first().locator(".sqn-mention").count()) === 1, "e-mail nao vira mencao", corpo1);

    const card = page.locator(".sqn-note").first();
    await card.locator("button", { hasText: "Excluir" }).click();
    ok(await card.locator(".sqn-badge").isVisible(), "selo do portal continua visivel durante a confirmacao de excluir");
    await card.locator("button", { hasText: "Cancelar" }).click();

    const vis = async () => [await page.isVisible('[aria-label="Encostar o painel na esquerda"]'), await page.isVisible('[aria-label="Encostar o painel na direita"]'), await page.isVisible(".sqn-grip-left"), await page.isVisible(".sqn-grip-right")].join();
    ok(await vis() === "true,false,true,false", "encostado a direita: so seta para a esquerda e canto esquerdo", await vis());
    await page.click('[aria-label="Encostar o painel na esquerda"]');
    const esq = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect());
    ok(esq.left === 12 && esq.top === 12 && esq.bottom === 788, "seta leva o painel direto para a esquerda, de cima a baixo", JSON.stringify(esq));
    ok(await vis() === "false,true,false,true", "encostado a esquerda: so seta para a direita e canto direito", await vis());
    const tabL = await page.$eval(".sqn-tab", (e) => e.getBoundingClientRect().left);
    ok(tabL >= esq.right - 1, "aba fica do lado de fora do painel encostado a esquerda", `aba=${tabL} painel.right=${esq.right}`);

    // canto direito estica na diagonal; continua encostado e lembra o tamanho
    const g = await page.$eval(".sqn-grip-right", (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + 200, g.y - 300, { steps: 5 });
    await page.mouse.up();
    const grande = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect());
    ok(Math.round(grande.width - esq.width) === 200 && Math.round(esq.height - grande.height) === 300 && grande.left === 12, "canto direito muda largura e altura juntas, encostado", JSON.stringify(grande));
    const salvo = await page.evaluate(() => SQDrag.saved("notes"));
    ok(salvo && salvo.dock === "left" && Math.round(salvo.width) === Math.round(grande.width), "tamanho e lado ficam salvos", JSON.stringify(salvo));

    await page.click('[aria-label="Encostar o painel na direita"]');
    const dir = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect());
    ok(Math.round(dir.right) === 1280 - 12 && Math.round(dir.width) === Math.round(grande.width), "seta para a direita encosta mantendo a largura escolhida", JSON.stringify(dir));
    const tabR = await page.$eval(".sqn-tab", (e) => e.getBoundingClientRect().right);
    ok(tabR <= dir.left + 1, "aba acompanha o painel largo encostado a direita", `aba.right=${tabR} painel.left=${dir.left}`);

    // nao passa da tela: canto esquerdo puxado para fora dela
    const g2 = await page.$eval(".sqn-grip-left", (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 }; });
    await page.mouse.move(g2.x, g2.y);
    await page.mouse.down();
    await page.mouse.move(-5000, 5000, { steps: 3 });
    await page.mouse.up();
    const max = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect());
    ok(max.left >= 12 && max.bottom <= 800 - 12 && Math.round(max.right) === 1280 - 12, "esticar nao passa da tela", JSON.stringify(max));

    // solto: as duas setas e os dois cantos
    const h = await page.$eval(".sqn-head", (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 60, y: r.top + 20 }; });
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x - 150, h.y + 40, { steps: 5 });
    await page.mouse.up();
    ok(await vis() === "true,true,true,true", "solto: as duas setas e os dois cantos", await vis());

    // fechar e abrir de novo restaura do que foi salvo (o mesmo caminho de recarregar a pagina)
    await page.click('[aria-label="Encostar o painel na esquerda"]');
    const antes = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect().width);
    await page.click('[aria-label="Recolher painel de notas"]');
    await page.$eval(".sqn-panel", (e) => ["left", "right", "width", "height", "top", "bottom"].forEach((k) => { e.style[k] = ""; }));
    await page.click(".sqn-tab");
    await page.waitForTimeout(300);
    const depois = await page.$eval(".sqn-panel", (e) => e.getBoundingClientRect());
    ok(depois.left === 12 && Math.round(depois.width) === Math.round(antes), "reabrir restaura o lado e a largura salvos", JSON.stringify(depois));
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
    ok((await page.textContent(".sqn-input")) === "Texto que nao pode sumir", "texto fica no campo quando o Zoho recusa");
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
