/**
 * notes-panel.js — painel lateral de notas em qualquer registro do Zoho CRM.
 *
 * Uma aba "Notas" fica presa na borda direita de toda pagina de registro
 * (Deal, Lead, Contact, modulo custom...). Ela abre um painel fixo, que segue
 * a rolagem, com todas as notas do registro e um campo para escrever uma nova,
 * gravada nas notas do proprio registro. Pedido do Mauro: comparar as notas com
 * o resto da tela sem descer e subir a pagina.
 *
 * Fonte: API de Notes do Zoho (v8: GET/POST /{modulo}/{id}/Notes), com a sessao
 * da aba via `SQZoho`. Chamado pelo observer unico do `content.js` via `tick()`.
 *
 * Expoe `globalThis.SQNotesPanel = { tick }`.
 */
(function () {
    'use strict';

    var FIELDS = "Note_Title,Note_Content,Created_Time,Created_By,Owner";
    var MAX_PAGES = 10; // 2000 notas: teto para nao varrer sem fim
    var ALIASES = { Potentials: "Deals" };

    var tabToApi = null;   // nome na URL -> api_name do modulo
    var current = null;    // { tab, module, id }
    var isOpen = false;
    var tab = null, panel = null, listEl = null, countEl = null, input = null, sendBtn = null, errEl = null;
    var loadSeq = 0;
    var drafts = {};       // rascunho por registro: trocar de registro nao leva o texto junto

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    /** Conteudo de nota pode vir com HTML: vira texto puro, sem executar nada. */
    function plain(s) {
        if (!s) return "";
        if (s.indexOf("<") === -1) return s;
        var withBreaks = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n");
        var doc = new DOMParser().parseFromString(withBreaks, "text/html");
        return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    }

    function fmtDate(iso) {
        var d = new Date(iso);
        if (isNaN(d)) return "";
        return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    function recordFromUrl() {
        var m = location.pathname.match(/\/tab\/([A-Za-z0-9_]+)\/(\d+)\/?$/);
        return m ? { tab: m[1], id: m[2] } : null;
    }

    async function resolveModule(tabName) {
        if (!tabToApi) {
            tabToApi = Object.assign({}, ALIASES);
            try {
                var body = await globalThis.SQZoho.get("/settings/modules");
                (body.modules || []).forEach(function (mod) {
                    if (mod.api_name) {
                        tabToApi[mod.api_name] = mod.api_name;
                        if (mod.module_name) tabToApi[mod.module_name] = mod.api_name;
                    }
                });
            } catch (e) { /* sem mapa: usa o nome da URL e o erro aparece no painel */ }
        }
        return tabToApi[tabName] || tabName;
    }

    // ---------- montagem ----------
    function build() {
        tab = el("button", "sqn-tab", "Notas");
        tab.type = "button";
        tab.title = "Notas deste registro";
        tab.setAttribute("aria-expanded", "false");
        tab.addEventListener("click", function () { setOpen(!isOpen); });

        panel = el("aside", "sqn-panel");
        panel.setAttribute("aria-label", "Notas do registro");
        panel.hidden = true;

        var head = el("div", "sqn-head");
        head.appendChild(el("strong", "sqn-title", "Notas"));
        countEl = el("span", "sqn-count");
        head.appendChild(countEl);
        var spacer = el("span", "sqn-spacer");
        head.appendChild(spacer);
        var refresh = el("button", "sqn-icon-btn", "↻");
        refresh.type = "button";
        refresh.title = "Recarregar notas";
        refresh.setAttribute("aria-label", "Recarregar notas");
        refresh.addEventListener("click", function () { load(); });
        var close = el("button", "sqn-icon-btn", "✕");
        close.type = "button";
        close.title = "Fechar";
        close.setAttribute("aria-label", "Fechar painel de notas");
        close.addEventListener("click", function () { setOpen(false); });
        head.appendChild(refresh);
        head.appendChild(close);

        listEl = el("div", "sqn-list");
        listEl.setAttribute("aria-live", "polite");

        var form = el("form", "sqn-compose");
        input = el("textarea", "sqn-input");
        input.placeholder = "Escreva uma nota…";
        input.rows = 3;
        input.setAttribute("aria-label", "Nova nota");
        input.addEventListener("input", syncSend);
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
        });
        var row = el("div", "sqn-compose-row");
        row.appendChild(el("span", "sqn-hint", "Ctrl/⌘ + Enter envia"));
        sendBtn = el("button", "sqn-send", "Adicionar nota");
        sendBtn.type = "submit";
        row.appendChild(sendBtn);
        errEl = el("div", "sqn-error-inline");
        errEl.setAttribute("role", "alert");
        errEl.hidden = true;
        form.appendChild(input);
        form.appendChild(errEl);
        form.appendChild(row);
        form.addEventListener("submit", function (e) { e.preventDefault(); send(); });

        panel.appendChild(head);
        panel.appendChild(listEl);
        panel.appendChild(form);
        document.body.appendChild(panel);
        document.body.appendChild(tab);
        syncSend();

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && isOpen && panel.contains(document.activeElement)) setOpen(false);
        });
    }

    function syncSend() {
        if (sendBtn) sendBtn.disabled = !input.value.trim() || sendBtn.dataset.busy === "1";
    }

    function setOpen(open) {
        isOpen = open;
        panel.hidden = !open;
        tab.setAttribute("aria-expanded", open ? "true" : "false");
        tab.classList.toggle("sqn-tab-open", open);
        if (open) { load(); input.focus(); }
    }

    // ---------- estados da lista ----------
    function showMessage(cls, text, retry) {
        listEl.textContent = "";
        var box = el("div", cls);
        box.appendChild(el("p", null, text));
        if (retry) {
            var b = el("button", "sqn-retry", "Tentar de novo");
            b.type = "button";
            b.addEventListener("click", function () { load(); });
            box.appendChild(b);
        }
        listEl.appendChild(box);
    }

    function render(notes) {
        countEl.textContent = notes.length === 1 ? "1 nota" : notes.length + " notas";
        listEl.textContent = "";
        if (!notes.length) {
            showMessage("sqn-empty", "Este registro ainda não tem notas. Escreva a primeira no campo abaixo.");
            return;
        }
        notes.forEach(function (n) {
            var item = el("article", "sqn-note");
            var meta = el("div", "sqn-meta");
            var who = (n.Created_By && n.Created_By.name) || (n.Owner && n.Owner.name) || "—";
            meta.appendChild(el("span", "sqn-author", who));
            meta.appendChild(el("time", "sqn-date", fmtDate(n.Created_Time)));
            item.appendChild(meta);
            if (n.Note_Title) item.appendChild(el("div", "sqn-note-title", n.Note_Title));
            item.appendChild(el("div", "sqn-body", plain(n.Note_Content)));
            listEl.appendChild(item);
        });
    }

    async function fetchNotes(rec) {
        var all = [];
        for (var page = 1; page <= MAX_PAGES; page++) {
            var q = new URLSearchParams({ fields: FIELDS, per_page: 200, page: page });
            var body = await globalThis.SQZoho.get("/" + rec.module + "/" + rec.id + "/Notes?" + q);
            all = all.concat(body.data || []);
            if (!(body.info && body.info.more_records)) break;
        }
        // A API devolve da mais antiga para a mais nova; o painel mostra a mais nova no topo.
        all.sort(function (a, b) { return new Date(b.Created_Time) - new Date(a.Created_Time); });
        return all;
    }

    async function load() {
        if (!current || !panel) return;
        var seq = ++loadSeq;
        countEl.textContent = "";
        showMessage("sqn-loading", "Carregando notas…");
        try {
            current.module = await resolveModule(current.tab);
            var notes = await fetchNotes(current);
            if (seq === loadSeq) render(notes);
        } catch (e) {
            if (seq !== loadSeq) return;
            showMessage("sqn-error",
                "Não foi possível carregar as notas. " + e.message +
                ". Confira se você ainda está logado no Zoho e tente de novo.", true);
        }
    }

    async function send() {
        var text = input.value.trim();
        if (!text || !current || sendBtn.dataset.busy === "1") return;
        sendBtn.dataset.busy = "1";
        sendBtn.textContent = "Salvando…";
        errEl.hidden = true;
        syncSend();
        try {
            current.module = await resolveModule(current.tab);
            var res = await globalThis.SQZoho.post("/" + current.module + "/" + current.id + "/Notes", {
                data: [{
                    Note_Content: text,
                    Parent_Id: { module: { api_name: current.module }, id: current.id }
                }]
            });
            var d = res.data && res.data[0];
            if (!d || d.code !== "SUCCESS") throw new Error((d && d.message) || "resposta inesperada do Zoho");
            input.value = "";
            delete drafts[current.id];
            await load();
        } catch (e) {
            // O texto fica no campo: nada do que a pessoa escreveu se perde.
            errEl.textContent = "A nota não foi salva. " + e.message + ". O texto continua no campo; tente de novo.";
            errEl.hidden = false;
        } finally {
            sendBtn.dataset.busy = "0";
            sendBtn.textContent = "Adicionar nota";
            syncSend();
        }
    }

    // ---------- troca de pagina ----------
    var lastUrl = "";
    function tick() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        var rec = recordFromUrl();
        if (!rec) {
            current = null;
            if (tab) { tab.hidden = true; panel.hidden = true; }
            return;
        }
        if (current && current.id === rec.id) return;
        if (current && input) drafts[current.id] = input.value;
        current = { tab: rec.tab, module: null, id: rec.id };
        if (!tab) build();
        input.value = drafts[rec.id] || "";
        syncSend();
        tab.hidden = false;
        errEl.hidden = true;
        if (isOpen) { panel.hidden = false; load(); }
    }

    globalThis.SQNotesPanel = { tick: tick };
})();
