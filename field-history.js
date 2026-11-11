/**
 * field-history.js — historico de alteracoes de campo no Zoho CRM.
 *
 * Coloca um icone de relogio ao lado do nome de cada campo, em qualquer modulo
 * (Deal, Lead, Contact, modulo custom...).
 * Clicar mostra toda a mudanca daquele campo: valor anterior, novo valor, quem
 * mudou e quando. A fonte e a Timeline do proprio registro, lida com a sessao
 * que ja esta aberta na aba. Quando o Zoho recusa a chamada, o modulo le o que
 * a aba Timeline mostra na tela e guarda.
 *
 * Base: extensao "Zoho CRM Field History" 3.4.0 (Mauro). Tres mudancas foram
 * necessarias para viver dentro desta extensao, e nenhuma e cosmetica:
 *
 *  1. `chrome.storage.*` virou `SQBrowser` — o original so roda em Chrome/Edge;
 *     esta extensao tambem roda em Firefox e Safari, onde a API e `browser.*`
 *     com Promises.
 *  2. O MutationObserver proprio saiu. Dois observers varrendo `document.body`
 *     inteiro em paralelo dobram o custo na pagina mais pesada do CRM; quem
 *     chama `tick()` agora e o observer unico do `content.js`.
 *  3. O listener `chrome.runtime.onMessage` proprio saiu. Em MV3 o PRIMEIRO
 *     listener que chama `sendResponse` vence — o nosso, que responde
 *     `undefined` a mensagem desconhecida, engoliria a resposta de status.
 *     Agora existe um despachante so, no `content.js`, que chama `status()`.
 *
 * Expoe `globalThis.SQFieldHistory = { tick, status }`.
 */
(function () {
    'use strict';

    var SQ = globalThis.SQBrowser;

    // O relogio e montado por DOM, nao por `innerHTML`. O original usava string
    // (constante, sem dado de usuario), mas o `web-ext lint` do Firefox reprova
    // atribuicao a innerHTML como UNSAFE_VAR_ASSIGNMENT e isso travaria a
    // publicacao na AMO. Construir o no custa o mesmo e some com o aviso.
    var ICON_CLOCK = "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2";
    function clockIcon() {
        var NS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "14");
        svg.setAttribute("height", "14");
        svg.setAttribute("aria-hidden", "true");
        var path = document.createElementNS(NS, "path");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("d", ICON_CLOCK);
        svg.append(path);
        return svg;
    }

    // Teto de entradas raspadas por registro. A raspagem so acontece quando a
    // API recusa, mas sem teto a chave `tl_<id>` cresce para sempre dentro de
    // um storage de 10 MB compartilhado com o resto da extensao.
    var MAX_SCRAPED = 500;

    var norm = function (s) {
        return (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim().replace(/[:*]+$/, "").trim().toLowerCase();
    };

    var status = { page: null, labels: 0, icons: 0, apiError: null, scraped: 0 };
    var current = null;           // { module, id }
    var labels = new Map();       // rotulo normalizado -> rotulo de exibicao
    var apiHistory = null;        // rotulo normalizado -> [mudancas] (da API)
    var apiPromise = null;
    var labelToApi = new Map();   // rotulo normalizado -> api name
    var record = null;            // o proprio registro: Created_By, Created_Time, valores atuais
    var popover = null;

    // API do Zoho com a sessao da aba: fonte unica em zoho-api.js.
    var get = function (path) { return globalThis.SQZoho.get(path); };

    async function loadApi(module, id) {
        // Nomes dos campos (para o icone aparecer tambem em campo nunca alterado)
        try {
            var body = await get("/settings/fields?module=" + module);
            (body.fields || []).forEach(function (f) {
                var l = f.field_label || f.display_label;
                if (l) { labels.set(norm(l), l); labelToApi.set(norm(l), f.api_name); }
            });
        } catch (e) { status.apiError = e.message; }

        // O proprio registro, para a linha "criado"
        try {
            var rec = await get("/" + module + "/" + id);
            record = (rec.data || [])[0] || null;
        } catch (e) { record = null; }

        // Timeline inteira, pagina a pagina
        var hist = {};
        var page = 1, pageToken = null;
        for (var i = 0; i < 200; i++) {
            var q = new URLSearchParams({ per_page: 200 });
            if (pageToken) q.set("page_token", pageToken); else q.set("page", page);
            var body2 = await get("/" + module + "/" + id + "/__timeline?" + q);
            (body2.__timeline || []).forEach(function (ev) {
                (ev.field_history || []).forEach(function (fh) {
                    var label = fh.field_label || fh.api_name;
                    labels.set(norm(label), label);
                    var k = norm(label);
                    if (!hist[k]) hist[k] = [];
                    hist[k].push({
                        when: ev.audited_time,
                        by: (ev.done_by && ev.done_by.name) || "Desconhecido",
                        old: (fh._value && fh._value.old) != null ? fh._value.old : null,
                        new: (fh._value && fh._value.new) != null ? fh._value.new : null
                    });
                });
            });
            var info = body2.info || {};
            if (!info.more_records) break;
            pageToken = info.next_page_token || null;
            page++;
        }
        status.apiError = null;
        return hist;
    }

    // ---------- Reserva: ler a aba Timeline que esta na tela ----------
    // Casa linhas como: "English Pipeline was updated from Waiting... to Scheduled"
    //                   "by Carina Casalecchi Pereira 11/09/2026"
    function textOf(node) {
        var parts = [];
        var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (var n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue);
        return parts.join(" ").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    }
    var count = function (t, s) { return t.split(s).length - 1; };
    var UPDATED = /^(.+?) was updated from (.+?) to (.+?)(?: by (.+?) (\d{1,2}\/\d{1,2}\/\d{4}))?$/;

    /** Elementos que contem uma entrada "X was updated from ..." nas raizes (o menor que contem a frase). */
    function timelineEntries(roots) {
        var out = new Set();
        (roots || [document.body]).forEach(function (root) {
            var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (var n = w.nextNode(); n; n = w.nextNode()) {
                if (n.nodeValue.indexOf("was updated from") === -1) continue;
                var el2 = n.parentElement;
                for (var i = 0; el2 && i < 3 && textOf(el2).indexOf(" was updated from ") === -1; i++) el2 = el2.parentElement;
                if (el2) out.add(el2);
            }
        });
        return out;
    }

    function scrapeTimeline(roots) {
        // Reserva: so le a tela quando a API recusou. Com a API ok, a tela nao acrescenta nada.
        if (!current || !status.apiError) return;
        var found = [];
        timelineEntries(roots).forEach(function (el2) {
            var t = textOf(el2);
            if (t.length > 600) return;
            var row = el2, text = t;
            // sobe ate incluir a linha "by Nome dd/mm/aaaa"
            for (var i = 0; i < 4 && !/ by .+ \d{1,2}\/\d{1,2}\/\d{4}/.test(text) && row.parentElement; i++) {
                var up = textOf(row.parentElement);
                if (count(up, " was updated from ") > 1) break;
                row = row.parentElement;
                text = up;
            }
            var start = text.indexOf(t.split(" was updated from ")[0]);
            var m = text.slice(start).match(UPDATED);
            if (!m) return;
            // a hora ("13:02") fica ao lado da entrada
            var time = null, box = row;
            for (var j = 0; j < 4 && box && !time; j++, box = box.parentElement) {
                var bt = textOf(box);
                if (j > 0 && count(bt, " was updated from ") > 1) break;
                // ignora hora que faz parte de um valor (ex.: "11/09/2026 09:00")
                time = (bt.replace(/\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}/g, "").match(/\b(\d{1,2}:\d{2})\b/) || [])[1];
            }
            var date = m[5];
            var when = null;
            if (date) {
                var parts2 = date.split("/").map(Number);
                var hm = (time || "00:00").split(":").map(Number);
                when = new Date(parts2[2], parts2[1] - 1, parts2[0], hm[0], hm[1]).toISOString();
            }
            var blank = function (v) { return /^blank value$/i.test(v.trim()) ? null : v.trim(); };
            found.push({
                label: m[1].trim(), old: blank(m[2]), new: blank(m[3].replace(/ by .*$/, "")),
                by: m[4] || "Desconhecido", when: when, hasTime: !!time
            });
        });
        if (!found.length) return;
        var key = "tl_" + current.id;
        SQ.storageGet(key).then(function (r) {
            var stored = (r && r[key]) || [];
            var sig = function (c) { return norm(c.label) + "|" + c.when + "|" + c.old + "|" + c.new; };
            var seen = new Set(stored.map(sig));
            var before = stored.length;
            found.forEach(function (c) { if (!seen.has(sig(c))) { stored.push(c); seen.add(sig(c)); } });
            if (stored.length === before) return; // nada novo: nao regrava o storage
            if (stored.length > MAX_SCRAPED) stored = stored.slice(stored.length - MAX_SCRAPED);
            SQ.storageSet(Object.fromEntries([[key, stored]]));
            status.scraped = stored.length;
            stored.forEach(function (c) { labels.set(norm(c.label), c.label); });
            addIcons();
        });
    }

    async function historyFor(labelKey) {
        if (apiPromise) {
            try { apiHistory = await apiPromise; } catch (e) { status.apiError = e.message; }
        }
        if (apiHistory) return apiHistory[labelKey] || [];
        var key = "tl_" + current.id;
        var bag = await SQ.storageGet(key);
        var stored = (bag && bag[key]) || [];
        if (!stored.length) throw new Error("NO_DATA");
        return stored.filter(function (c) { return norm(c.label) === labelKey; });
    }

    // ---------- DOM (inclui shadow DOM) ----------
    function* allElements(root) {
        var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_ELEMENT);
        for (var n = walker.currentNode; n; n = walker.nextNode()) {
            yield n;
            if (n.shadowRoot) yield* allElements(n.shadowRoot);
        }
    }

    // ---------- Icones ----------
    function isTimelineText(el2) {
        // o nome do campo faz parte de uma frase da Timeline ("X was updated from ...")
        for (var n = el2, i = 0; n && i < 2; n = n.parentElement, i++) {
            var t = n.textContent;
            if (t.length < 600 && /was updated from|remains unmodified|were updated/.test(t)) return true;
        }
        return false;
    }

    /** Texto proprio do elemento (so os filhos de texto), ou "" sem gastar com quem nao tem. */
    function ownText(node) {
        var t = "";
        for (var c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += " " + c.nodeValue;
        return t;
    }

    /** `roots`: so esses pedacos do DOM (o que acabou de entrar); sem raizes, a pagina inteira. */
    function addIcons(roots) {
        if (!current || !labels.size) return;
        var placed = 0;
        (roots || [null]).forEach(function (root) {
        var it = allElements(root), step;
        while (!(step = it.next()).done) {
            var node = step.value;
            if (node.dataset && node.dataset.zfh) continue;
            if (node.isContentEditable) continue; // texto de nota sendo escrita/colada, nao rotulo de campo
            // elemento cujo texto proprio e exatamente o nome de um campo
            var own = ownText(node);
            if (!own || own.length > 200) continue;
            var key = norm(own);
            if (!key || key.length > 60 || !labels.has(key)) continue;
            if (node.closest && node.closest(".zfh-pop, .zfh-icon")) continue;
            if (/^(A|BUTTON|OPTION|SELECT|TEXTAREA|SCRIPT|STYLE|TITLE)$/.test(node.tagName)) continue;
            if (isTimelineText(node)) continue;
            node.dataset.zfh = "1";
            var btn = document.createElement("span");
            btn.className = "zfh-icon";
            btn.setAttribute("role", "button");
            btn.tabIndex = 0;
            btn.title = labels.get(key) + " — historico";
            btn.append(clockIcon());
            (function (button, k) {
                var open = function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openPopover(button, labels.get(k), k);
                };
                button.addEventListener("click", open, true);
                button.addEventListener("keydown", function (e) {
                    if (e.key === "Enter" || e.key === " ") open(e);
                });
            })(btn, key);
            node.prepend(btn);
            placed++;
        }
        });
        status.icons += placed;
    }

    // ---------- Popover ----------
    var el = function (tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };

    function fmtValue(v) {
        if (v === null || v === undefined || v === "") return null;
        if (Array.isArray(v)) return v.map(fmtValue).filter(Boolean).join(", ") || null;
        if (typeof v === "object") return v.name != null ? v.name : (v.display_value != null ? v.display_value : (v.value != null ? v.value : JSON.stringify(v)));
        if (typeof v === "boolean") return v ? "Sim" : "Nao";
        var t = String(v);
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) return fmtDate(t);
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.split("-").reverse().join("/");
        return t;
    }

    var fmtDate = function (iso) {
        return iso ? new Date(iso).toLocaleString("en-GB", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        }).replace(",", "") : "Sem registro";
    };

    function closePopover() {
        if (popover) popover.remove();
        popover = null;
    }

    function place(anchor) {
        var r = anchor.getBoundingClientRect(), w = popover.offsetWidth, h = popover.offsetHeight;
        var top = r.bottom + 6;
        if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 6);
        popover.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px";
        popover.style.top = top + "px";
    }

    async function openPopover(anchor, label, key) {
        closePopover();
        popover = el("div", "zfh-pop");
        var head = el("div", "zfh-head");
        var close = el("span", "zfh-close", "×");
        close.setAttribute("role", "button");
        close.onclick = closePopover;
        head.append(el("span", "zfh-title", label), close);
        var body = el("div", "zfh-body", "Carregando…");
        popover.append(head, body);
        document.body.append(popover);
        place(anchor);

        var changes;
        try { changes = await historyFor(key); }
        catch (e) {
            if (!popover) return;
            body.textContent = "";
            body.append(el("p", "zfh-error", e.message === "NO_DATA"
                ? "Nao consegui ler o historico automaticamente. Abra a aba Timeline deste registro uma vez e role ate o fim; depois clique no icone de novo."
                : "Nao consegui carregar o historico: " + e.message));
            place(anchor);
            return;
        }
        if (!popover) return;
        changes = changes.filter(function (c) { return fmtValue(c.old) !== fmtValue(c.new); });
        changes = changes.slice().sort(function (a, b) { return new Date(b.when || 0) - new Date(a.when || 0); });
        body.textContent = "";

        // Com que valor o campo nasceu, na criacao do registro
        var created = null;
        if (record && record.Created_Time) {
            var api = labelToApi.get(key);
            var initial = changes.length ? changes[changes.length - 1].old : (api ? record[api] : undefined);
            if (changes.length || api) {
                created = {
                    value: fmtValue(initial),
                    by: (record.Created_By && record.Created_By.name) || "Desconhecido",
                    when: record.Created_Time
                };
            }
        }
        if (!changes.length && !created) {
            body.append(el("p", "zfh-empty", "Nenhuma alteracao registrada neste campo."));
            place(anchor);
            return;
        }

        var now = el("div", "zfh-now");
        now.append("Valor atual: ");
        var atual = fmtValue(changes.length ? changes[0].new : created.value);
        now.append(el("strong", "", atual != null ? atual : "Vazio"));
        now.append(el("span", "zfh-count", changes.length
            ? changes.length + (changes.length === 1 ? " alteracao" : " alteracoes") + " desde a criacao"
            : "Nunca alterado desde a criacao"));
        body.append(now);

        var table = el("table", "zfh-table");
        var hr = el("tr");
        ["Valor anterior", "Novo valor", "Alterado por", "Data e hora"].forEach(function (t) { hr.append(el("th", "", t)); });
        var thead = el("thead"); thead.append(hr);
        var tbody = el("tbody");
        changes.forEach(function (c) {
            var tr = el("tr");
            var from = fmtValue(c.old), to = fmtValue(c.new);
            var fc = el("td", from ? "zfh-from" : "zfh-from zfh-blank", from != null ? from : "Vazio");
            var tc = el("td", to ? "zfh-to" : "zfh-to zfh-blank", to != null ? to : "Vazio");
            fc.title = from || ""; tc.title = to || "";
            var bc = el("td", "zfh-by", c.by); bc.title = c.by;
            tr.append(fc, tc, bc, el("td", "zfh-when", fmtDate(c.when)));
            tbody.append(tr);
        });
        if (created) {
            var tr2 = el("tr", "zfh-created");
            var tc2 = el("td", created.value ? "zfh-to" : "zfh-to zfh-blank", created.value != null ? created.value : "Vazio");
            tc2.title = created.value || "";
            var bc2 = el("td", "zfh-by", created.by); bc2.title = created.by;
            tr2.append(
                el("td", "zfh-origin", current.label + " criado"),
                tc2, bc2, el("td", "zfh-when", fmtDate(created.when))
            );
            tbody.append(tr2);
        }
        table.append(thead, tbody);
        var scroll = el("div", "zfh-scroll");
        scroll.append(table);
        body.append(scroll);
        place(anchor);
    }

    document.addEventListener("mousedown", function (e) {
        if (popover && !popover.contains(e.target) && !(e.target.closest && e.target.closest(".zfh-icon"))) closePopover();
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePopover(); });

    // ---------- Troca de registro ----------
    var lastUrl = "";
    async function onUrl() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        closePopover();
        var rec = globalThis.SQZoho.recordFromUrl();
        if (rec && current && rec.id === current.id) return;
        var next = rec ? { tab: rec.tab, module: rec.tab, label: rec.tab, id: rec.id } : null;
        current = next;
        labels = new Map(); labelToApi = new Map(); record = null; apiHistory = null; apiPromise = null;
        Object.assign(status, {
            page: current ? current.module + " " + current.id : null,
            labels: 0, icons: 0, apiError: null, scraped: 0
        });
        if (!current) return;
        var key = "tl_" + current.id;
        var bag = await SQ.storageGet(key);
        var stored = (bag && bag[key]) || [];
        status.scraped = stored.length;
        stored.forEach(function (c) { labels.set(norm(c.label), c.label); });
        var mod = await globalThis.SQZoho.module(next.tab);
        if (current !== next) return; // trocou de registro enquanto resolvia
        next.module = mod.api; next.label = mod.label;
        status.page = next.module + " " + next.id;
        apiPromise = loadApi(current.module, current.id);
        apiPromise.then(function (h) { apiHistory = h; addIcons(); })
            .catch(function (e) { status.apiError = e.message; scrapeTimeline(); }); // API recusou: le a Timeline que ja esta na tela
        addIcons();
    }

    globalThis.SQFieldHistory = {
        /** Chamado pelo observer unico do content.js com o que entrou no DOM (sem raizes = pagina inteira). */
        tick: function (roots) {
            onUrl();
            addIcons(roots);
            scrapeTimeline(roots);
        },
        /** Estado para o popup (diagnostico). */
        status: function () {
            return Object.assign({}, status, { labels: labels.size });
        }
    };
})();
