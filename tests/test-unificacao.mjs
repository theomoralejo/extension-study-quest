/**
 * test-unificacao.mjs — prova que o historico de campo e as quick replies
 * convivem num content script so.
 *
 * Os tres riscos reais da unificacao, e o que cada um custaria se voltasse:
 *
 *  1. DOIS `onMessage`. Em MV3 vence o primeiro listener que chama
 *     `sendResponse`; o nosso responde `undefined` a mensagem desconhecida,
 *     entao um segundo listener nunca seria ouvido e o popup ficaria mudo sem
 *     nenhum erro. O teste conta os listeners: tem que ser UM.
 *  2. Ordem de carga. `field-history.js` tem que vir ANTES de `content.js` no
 *     manifest; ao contrario, `tickFieldHistory()` sempre acha o modulo ausente
 *     e o icone nunca aparece — tambem em silencio.
 *  3. Colisao de CSS entre os dois conjuntos de estilo.
 *
 * Roda em Node puro, sem navegador: `node tests/test-unificacao.mjs`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

let falhas = 0;
const ok = (cond, nome, detalhe = "") => {
    console.log(`${cond ? "PASS" : "FALHA"}  ${nome}${cond || !detalhe ? "" : " — " + detalhe}`);
    if (!cond) falhas++;
};

// ---- DOM minimo: so o que os dois scripts tocam ao carregar ----
function fakeEl(tag = "div") {
    const el = {
        tagName: tag.toUpperCase(), dataset: {}, style: {}, childNodes: [], children: [],
        textContent: "", className: "", tabIndex: 0, title: "",
        shadowRoot: null, parentElement: null,
        appendChild: (c) => c, append() { }, prepend() { }, remove() { },
        setAttribute() { }, addEventListener() { }, removeEventListener() { },
        querySelector: () => null, querySelectorAll: () => [],
        closest: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0 })
    };
    return el;
}

const listeners = [];
const sandbox = {
    console: { log() { }, error() { }, warn() { } },
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0,
    innerHeight: 800, innerWidth: 1200,
    addEventListener() { }, removeEventListener() { },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    URLSearchParams,
    MutationObserver: class { observe() { } disconnect() { } },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    location: { href: "https://crm.zoho.eu/crm/org123/tab/Potentials/456", pathname: "/crm/org123/tab/Potentials/456" },
    document: {
        cookie: "", body: fakeEl("body"), documentElement: fakeEl("html"),
        createElement: fakeEl, createElementNS: () => fakeEl("svg"),
        createTreeWalker: () => ({ currentNode: null, nextNode: () => null }),
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener() { }, getElementById: () => null
    },
    chrome: {
        runtime: {
            lastError: null,
            onMessage: { addListener: (fn) => listeners.push(fn) },
            getURL: (p) => p
        },
        storage: { local: { get: (k, cb) => cb && cb({}), set: (i, cb) => cb && cb() } },
        tabs: { query: (q, cb) => cb && cb([]), sendMessage: (id, m, cb) => cb && cb(null) }
    }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// ---- carga na MESMA ordem declarada no manifest ----
const manifest = JSON.parse(read("manifest.json"));
const cs = manifest.content_scripts[0];
ok(cs.js.indexOf("field-history.js") < cs.js.indexOf("content.js"),
    "field-history.js carrega antes de content.js no manifest",
    `ordem atual: ${cs.js.join(", ")}`);
for (const dep of ["zoho-api.js", "notes-panel.js"]) {
    ok(cs.js.indexOf(dep) > -1 && cs.js.indexOf(dep) < cs.js.indexOf("content.js"),
        `${dep} carrega antes de content.js no manifest`, `ordem atual: ${cs.js.join(", ")}`);
}
ok(cs.js.indexOf("zoho-api.js") < cs.js.indexOf("field-history.js"),
    "zoho-api.js carrega antes de field-history.js (que usa SQZoho)", `ordem atual: ${cs.js.join(", ")}`);


for (const f of cs.js) {
    try {
        vm.runInContext(read(f), sandbox, { filename: f });
    } catch (e) {
        ok(false, `${f} carrega sem lancar`, e.message);
    }
}

// ---- 1. um despachante so ----
ok(listeners.length === 1, "existe UM unico listener de mensagem",
    `encontrados ${listeners.length}`);

// ---- 2. o despachante responde as duas features, e ignora o resto ----
const perguntar = (msg) => new Promise((res) => {
    if (typeof listeners[0] !== "function") return res(undefined);
    let respondeu = false;
    const manter = listeners[0](msg, {}, (r) => { respondeu = true; res(r); });
    if (!manter && !respondeu) res(undefined);
});

const status = await perguntar({ action: "fieldHistoryStatus" });
ok(status && typeof status.icons === "number",
    "responde 'fieldHistoryStatus' com o estado do historico",
    JSON.stringify(status));

const autor = await perguntar({ action: "getAuthor" });
ok(autor && "author" in autor, "responde 'getAuthor' das quick replies", JSON.stringify(autor));

const nada = await perguntar({ action: "inexistente" });
ok(nada === undefined, "mensagem desconhecida nao recebe resposta inventada", JSON.stringify(nada));

// ---- 3. o modulo esta exposto e e chamavel ----
ok(sandbox.SQFieldHistory && typeof sandbox.SQFieldHistory.tick === "function",
    "SQFieldHistory.tick() existe para o observer unico chamar");

ok(sandbox.SQNotesPanel && typeof sandbox.SQNotesPanel.tick === "function",
    "SQNotesPanel.tick() existe para o observer unico chamar");

// ---- 4. nenhuma classe CSS compartilhada entre os arquivos de estilo ----
const classes = (f) => new Set((read(f).match(/\.[a-zA-Z][\w-]*/g) || []));
const folhas = cs.css;
for (let i = 0; i < folhas.length; i++) for (let j = i + 1; j < folhas.length; j++) {
    const a = classes(folhas[i]), b = classes(folhas[j]);
    const colisao = [...b].filter((c) => a.has(c));
    ok(colisao.length === 0, `nenhuma classe CSS colide entre ${folhas[i]} e ${folhas[j]}`, colisao.join(", "));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou");
process.exit(falhas ? 1 : 0);
