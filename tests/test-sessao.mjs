/**
 * test-sessao.mjs — sessao da extensao (login da Master Table), sem navegador.
 *
 * Carrega browser-api.js + config.js + sessao.js de verdade num `vm`, com
 * `chrome.storage` e `fetch` falsos, e prova as regras do contrato
 * (.scratch/login-master-table/spec.md):
 *
 *  - toda chamada leva `Authorization: Bearer <token>`;
 *  - sem sessao (ou vencida) nenhuma chamada sai para a rede;
 *  - 401 apaga `sqSessao`;
 *  - o login guarda SO {token, name, email, expiresAt}: nem token PB, nem senha;
 *  - cada erro do login vira a mensagem certa, em pt-BR;
 *  - nenhum arquivo do pacote carrega a chave antiga nem o header `x-api-key`.
 *
 * Roda: `node tests/test-sessao.mjs`. Nada aqui fala com servidor real.
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

const SENHA = "senha-de-teste-123";
const PB_TOKEN = "pb-token-acesso-total-XYZ";
const EXT_TOKEN = "ext-token-so-respostas";
const FUTURO = "2999-01-01T00:00:00.000Z";

/** Monta um contexto novo: storage em memoria + fetch roteado por `rotas(url, init)`. */
function contexto(inicial = {}, rotas = () => { throw new Error("rota nao esperada"); }) {
    const store = JSON.parse(JSON.stringify(inicial));
    const chamadas = [];
    const ouvintes = [];
    const avisar = (changes) => setTimeout(() => ouvintes.forEach((fn) => fn(changes, "local")), 0);
    const pick = (keys) => {
        const out = {};
        [].concat(keys).forEach((k) => { if (k in store) out[k] = store[k]; });
        return out;
    };
    const sandbox = {
        console: { log() { }, error() { }, warn() { } },
        setTimeout, clearTimeout, AbortController, JSON, Date, Promise, Object,
        fetch: async (url, init = {}) => {
            chamadas.push({ url: String(url), init });
            const r = await rotas(String(url), init);
            const body = r.body === undefined ? "" : (typeof r.body === "string" ? r.body : JSON.stringify(r.body));
            return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => body, json: async () => JSON.parse(body) };
        },
        chrome: {
            runtime: { lastError: null, onMessage: { addListener() { } }, getURL: (p) => p },
            storage: {
                local: {
                    get: (k, cb) => cb(pick(k)),
                    set: (items, cb) => {
                        const ch = {};
                        for (const [k, v] of Object.entries(items)) { ch[k] = { oldValue: store[k], newValue: v }; store[k] = JSON.parse(JSON.stringify(v)); }
                        avisar(ch); cb && cb();
                    },
                    remove: (keys, cb) => {
                        const ch = {};
                        [].concat(keys).forEach((k) => { if (k in store) { ch[k] = { oldValue: store[k] }; delete store[k]; } });
                        avisar(ch); cb && cb();
                    }
                },
                onChanged: { addListener: (fn) => ouvintes.push(fn) }
            }
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const f of ["browser-api.js", "config.js", "sessao.js"]) vm.runInContext(read(f), sandbox, { filename: f });
    return { S: sandbox.SQSessao, CFG: sandbox.SQConfig, store, chamadas };
}

const sessaoValida = { sqSessao: { token: EXT_TOKEN, name: "Carina", email: "carina@x", expiresAt: FUTURO } };
const rejeita = (p) => p.then(() => null, (e) => e);

// ---------- 1. Bearer em toda chamada ----------
{
    const c = contexto(sessaoValida, () => ({ status: 200, body: [] }));
    await c.S.api("/replies");
    const h = c.chamadas[0] && c.chamadas[0].init.headers;
    ok(h && h.Authorization === "Bearer " + EXT_TOKEN, "GET leva Authorization: Bearer <token da extensao>", JSON.stringify(h));
    ok(c.chamadas[0] && c.chamadas[0].url === c.CFG.API_BASE + "/replies", "a chamada vai para API_BASE + path", c.chamadas[0] && c.chamadas[0].url);
    ok(h && !Object.keys(h).some((k) => k.toLowerCase() === "x-api-key"), "nenhuma chamada manda x-api-key", JSON.stringify(h));

    await c.S.api("/replies", { method: "POST", body: { title: "t" } });
    const p = c.chamadas[1] && c.chamadas[1].init;
    ok(p && p.method === "POST" && p.headers["Content-Type"] === "application/json" && p.body === '{"title":"t"}',
        "com body: JSON serializado e Content-Type application/json", JSON.stringify(p));
}

// ---------- 2. sem sessao: nada sai para a rede ----------
{
    const c = contexto({}, () => ({ status: 200, body: [] }));
    const e = await rejeita(c.S.api("/replies"));
    ok(c.chamadas.length === 0, "sem sessao, nenhuma chamada de rede", String(c.chamadas.length));
    ok(e && e.semSessao === true, "sem sessao, rejeita marcado como semSessao", e ? e.message : "resolveu");
}

// ---------- 3. sessao vencida = sem sessao ----------
{
    const c = contexto({ sqSessao: { token: EXT_TOKEN, name: "A", email: "a@x", expiresAt: "2000-01-01T00:00:00Z" } }, () => ({ status: 200, body: [] }));
    const e = await rejeita(c.S.api("/replies"));
    ok(c.chamadas.length === 0 && e && e.semSessao, "expiresAt no passado: tratada como sem sessao, sem rede", e ? e.message : "resolveu");
    ok(!("sqSessao" in c.store), "sessao vencida sai do storage");
    ok((await c.S.ler()) === null, "ler() devolve null para sessao vencida");
}

// ---------- 4. 401 apaga a sessao ----------
{
    const c = contexto(sessaoValida, () => ({ status: 401, body: { error: "sessao invalida", code: "sessao" } }));
    const e = await rejeita(c.S.api("/replies"));
    ok(e && e.semSessao === true && e.status === 401, "401 rejeita como semSessao", e ? e.message : "resolveu");
    ok(!("sqSessao" in c.store), "401 apaga sqSessao do storage", JSON.stringify(c.store));
}

// ---------- 5. login guarda so o contrato ----------
{
    const c = contexto({}, (url) => {
        if (url.endsWith("/api/collections/users/auth-with-password")) return { status: 200, body: { token: PB_TOKEN, record: { id: "u1", email: "carina@x" } } };
        if (url.endsWith("/auth/session")) return { status: 201, body: { token: EXT_TOKEN, name: "Carina", email: "carina@x", expiresAt: FUTURO, pbToken: PB_TOKEN, password: SENHA } };
        throw new Error("rota " + url);
    });
    const s = await c.S.entrar("  carina@x ", SENHA);
    const pb = c.chamadas[0], ses = c.chamadas[1];
    ok(pb && pb.url === c.CFG.MASTER_TABLE_URL + "/api/collections/users/auth-with-password" && pb.init.method === "POST",
        "passo 1: POST auth-with-password na Master Table", pb && pb.url);
    ok(pb && JSON.parse(pb.init.body).identity === "carina@x" && JSON.parse(pb.init.body).password === SENHA,
        "passo 1 manda {identity (sem espacos), password}", pb && pb.init.body);
    ok(ses && ses.url === c.CFG.API_BASE + "/auth/session" && JSON.parse(ses.init.body).pbToken === PB_TOKEN,
        "passo 2: POST /auth/session com {pbToken}", ses && ses.init.body);
    const guardado = c.store.sqSessao;
    ok(guardado && JSON.stringify(Object.keys(guardado).sort()) === JSON.stringify(["email", "expiresAt", "name", "token"]),
        "sqSessao tem exatamente {token, name, email, expiresAt}", JSON.stringify(guardado));
    const tudo = JSON.stringify(c.store);
    ok(!tudo.includes(PB_TOKEN), "token PB nao fica no storage", tudo);
    ok(!tudo.includes(SENHA), "senha nao fica no storage", tudo);
    ok(guardado && guardado.token === EXT_TOKEN && s.token === EXT_TOKEN, "o token guardado e o da extensao");
}

// ---------- 6. mensagens de erro do login ----------
async function loginCom(pbResp, sessResp) {
    const c = contexto({}, (url) => {
        if (url.includes("auth-with-password")) {
            if (pbResp === "rede") throw new TypeError("Failed to fetch");
            return pbResp;
        }
        return sessResp;
    });
    const e = await rejeita(c.S.entrar("a@x", SENHA));
    return { e, c };
}
{
    const r = await loginCom({ status: 400, body: { message: "Failed to authenticate." } });
    ok(r.e && r.e.message === "E-mail ou senha incorretos. Use o mesmo login da Master Table.", "PB 400 → e-mail ou senha incorretos", r.e && r.e.message);
    ok(r.c.chamadas.length === 1 && !("sqSessao" in r.c.store), "PB 400: nao chama a API das respostas nem grava nada");
}
{
    const r = await loginCom({ status: 401, body: { mfaId: "mfa123", message: "MFA" } });
    ok(r.e && /verificação em duas etapas/.test(r.e.message) && /TI/.test(r.e.message), "PB 401 com mfaId → verificação em duas etapas, falar com o TI", r.e && r.e.message);
}
{
    const r = await loginCom({ status: 429, body: { message: "Too Many Requests." } });
    ok(r.e && /Muitas tentativas/.test(r.e.message) && /um minuto/.test(r.e.message), "PB 429 → muitas tentativas, esperar um minuto", r.e && r.e.message);
}
{
    const r = await loginCom({ status: 200, body: { token: PB_TOKEN } }, { status: 403, body: { error: "Sua conta não tem a flag study_quest_extension." } });
    ok(r.e && r.e.message.startsWith("Sua conta da Master Table não tem acesso à extensão.") && r.e.message.includes("study_quest_extension"),
        "sessao 403 → linha pt-BR + mensagem do servidor", r.e && r.e.message);
    ok(!("sqSessao" in r.c.store), "sessao 403: nada gravado");
}
{
    const r = await loginCom("rede");
    ok(r.e && /sem conexão com a Master Table/.test(r.e.message) && /Confira a internet/.test(r.e.message), "rede caida → mensagem de conexao com o que fazer", r.e && r.e.message);
}
{
    const c = contexto({}, () => ({ status: 200, body: [] }));
    const e = await rejeita(c.S.entrar("", ""));
    ok(e && c.chamadas.length === 0, "login vazio nao chama a rede", e && e.message);
}

// ---------- 7. sair ----------
{
    const c = contexto(sessaoValida, () => ({ status: 204 }));
    await c.S.sair();
    const d = c.chamadas[0];
    ok(d && d.init.method === "DELETE" && d.url.endsWith("/auth/session") && d.init.headers.Authorization === "Bearer " + EXT_TOKEN,
        "sair: DELETE /auth/session com o Bearer", JSON.stringify(d));
    ok(!("sqSessao" in c.store), "sair apaga sqSessao");
    const c2 = contexto(sessaoValida, () => { throw new TypeError("Failed to fetch"); });
    await c2.S.sair();
    ok(!("sqSessao" in c2.store), "sair sem rede apaga sqSessao do mesmo jeito");
}

// ---------- 8. onMudar so reage a sqSessao ----------
{
    const c = contexto({}, () => ({ status: 200 }));
    const vistos = [];
    c.S.onMudar((s) => vistos.push(s ? s.token : null));
    await c.S.gravar({ token: "t1", name: "n", email: "e", expiresAt: FUTURO });
    await new Promise((r) => setTimeout(r, 5));
    await c.S.apagar();
    await new Promise((r) => setTimeout(r, 5));
    ok(JSON.stringify(vistos) === '["t1",null]', "onMudar avisa login e logout", JSON.stringify(vistos));
}

// ---------- 9. nenhum arquivo do pacote tem a chave antiga ----------
{
    const build = read("scripts/build.sh");
    const files = /FILES=\(([\s\S]*?)\)/.exec(build)[1].split(/\s+/).filter(Boolean);
    const manifest = JSON.parse(read("manifest.json"));
    const usados = [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css,
        ...[...read("popup.html").matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1])];
    const faltando = usados.filter((f) => !files.includes(f));
    ok(faltando.length === 0, "todo script/estilo que a extensao carrega esta em FILES do build.sh", faltando.join(", "));
    // montada por partes para este teste nao ser ele mesmo uma copia da chave
    // `.scratch/` = caminho interno do repositorio: nao vai para o codigo que o navegador recebe
    const proibidos = ["x-api-key", ["sq", "54321", "secret", "key"].join("-"), "API_KEY", ".scratch/"];
    const achados = [];
    for (const f of files) {
        const txt = read(f).toLowerCase();
        for (const p of proibidos) if (txt.includes(p.toLowerCase())) achados.push(`${f}: ${p}`);
    }
    ok(achados.length === 0, "nenhum arquivo do pacote contem x-api-key, API_KEY, a chave antiga ou caminho .scratch/", achados.join("; "));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo passou");
process.exit(falhas ? 1 : 0);
