/**
 * e2e-extensao.mjs — a extensao instalada de verdade num Chromium, com o
 * crm.zoho.com respondido por um Zoho de mentira.
 *
 * Diferente dos outros testes, aqui nada de `chrome.*` e simulado: o popup fala
 * com o content script pelo `chrome.tabs.sendMessage` real. Cobre o caminho que
 * so quebra instalado: popup -> aba do Deal -> API -> texto preenchido.
 *
 * Roda: `node tests/e2e-extensao.mjs`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const pw = await import("playwright");

let falhas = 0;
const ok = (cond, nome, detalhe = "") => {
    console.log(`${cond ? "PASS" : "FALHA"}  ${nome}${cond || !detalhe ? "" : " — " + detalhe}`);
    if (!cond) falhas++;
};

const REGISTRO = { id: "5725767000001", Deal_Name: "Maria Silva", Stage: "Qualification" };
const CAMPOS = [
    { api_name: "Deal_Name", field_label: "Deal Name", data_type: "text" },
    { api_name: "Stage", field_label: "Stage", data_type: "picklist" },
    { api_name: "st_Bonus_Payment", field_label: "Bonus Payment", data_type: "currency" }
];
const DEAL = "https://crm.zoho.com/crm/org123/tab/Potentials/5725767000001";
const REPLIES = [{ id: "1", title: "teste", text: "#Deal_Name teste [#st_Bonus_Payment]", category: "Geral", author: "Taz" }];

const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "sq-e2e-"));
const context = await pw.chromium.launchPersistentContext(perfil, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    permissions: ["clipboard-read", "clipboard-write"]
});

await context.route("https://crm.zoho.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/settings/modules")) return route.fulfill({ json: { modules: [{ api_name: "Deals", module_name: "Potentials", singular_label: "Deal" }] } });
    if (url.pathname.endsWith("/settings/fields")) return route.fulfill({ json: { fields: CAMPOS } });
    if (url.pathname.endsWith("/Deals/" + REGISTRO.id)) return route.fulfill({ json: { data: [REGISTRO] } });
    if (url.pathname.includes("/crm/v")) return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><h1>Deal</h1></body></html>" });
});
await context.route("https://cv.attriostudio.com/**", (route) => route.fulfill({ json: REPLIES }));

const deal = await context.newPage();
await deal.goto(DEAL);
await deal.waitForTimeout(1500); // content scripts em document_idle

// id da extensao instalada, pela pagina de extensoes (shadow DOM aberto)
const ext = await context.newPage();
await ext.goto("chrome://extensions");
const extId = await ext.locator("extensions-item").first().getAttribute("id");
ok(!!extId, "extensao carregada no Chromium", String(extId));

await ext.goto(`chrome-extension://${extId}/popup.html`);
await ext.waitForSelector(".reply-item");
const tabId = await ext.evaluate(async () => (await chrome.tabs.query({ url: "https://crm.zoho.com/*" }))[0].id);

// 1. mensagem real popup -> content script
const res = await ext.evaluate((id) => chrome.tabs.sendMessage(id, { action: "fillText", texts: ["#Deal_Name teste [#st_Bonus_Payment]"] }), tabId);
ok(res && res.status === "ok" && res.texts[0] === "Maria Silva teste []", "aba do Deal devolve o texto preenchido", JSON.stringify(res));

// 2. popup com o Deal como aba ativa da janela (como quando se clica no icone)
await deal.bringToFront();
await ext.reload();
await ext.waitForSelector(".reply-item");
await ext.waitForFunction(() => !document.getElementById("fillNote").classList.contains("is-hidden"), null, { timeout: 5000 }).catch(() => {});
const lista = await ext.textContent(".reply-text");
ok(lista === "Maria Silva teste []", "lista do popup mostra a resposta ja com os dados do Deal", JSON.stringify(lista));
ok((await ext.textContent("#fillNote")).includes("dados do registro aberto"), "popup diz que esta mostrando com o registro aberto");
await ext.click(".btn-copy");
await ext.waitForFunction(() => document.querySelector(".btn-copy").textContent === "Copiado", null, { timeout: 5000 }).catch(() => {});
const clip = await ext.evaluate(() => navigator.clipboard.readText());
ok(clip === "Maria Silva teste []", "Copiar no popup instalado leva os dados do Deal", JSON.stringify(clip));

// 3. aba do Zoho sem o content script (aberta antes de atualizar a extensao): manda recarregar
await deal.goto("https://crm.zoho.com/home/sem-content-script");
await deal.bringToFront();
await ext.reload();
await ext.waitForFunction(() => !document.getElementById("fillNote").classList.contains("is-hidden"), null, { timeout: 5000 }).catch(() => {});
ok((await ext.textContent("#fillNote")).includes("Recarregue a página do Zoho"), "aba sem resposta: popup manda recarregar o Zoho", await ext.textContent("#fillNote"));

await deal.goto("https://crm.zoho.com/crm/org123/tab/Potentials/list");
const semRegistro = await ext.evaluate((id) => chrome.tabs.sendMessage(id, { action: "fillText", texts: ["#Deal_Name"] }), tabId);
ok(semRegistro && semRegistro.status === "sem-registro", "fora de um Deal, a aba diz que nao ha registro", JSON.stringify(semRegistro));

await context.close();
fs.rmSync(perfil, { recursive: true, force: true });
console.log(falhas ? `${falhas} falha(s)` : "Tudo passou");
process.exit(falhas ? 1 : 0);
