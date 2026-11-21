/**
 * deal-info.js — cabecalho do Deal no painel de Notas (pedido do Mauro, tarefa
 * 6946750000083198022 do Zoho CRM da Study Quest).
 *
 * Tres pecas, so em registro de Deals:
 *  1. selos na linha do titulo (DSA, Speaking, Qnt. Deals, All Conditions Met + dias);
 *  2. grade 2x3 (Deal owner, Submitted by, Stage + dias, Student rep,
 *     Student consultant, Assessment tracker + dias);
 *  3. caixa "Important notes" (Important_Notes1) recolhivel e editavel.
 *
 * Dados: UMA leitura do Deal com `fields=` + UMA COQL de contagem por contato.
 * Qualquer erro fica contido aqui: o painel de notas continua funcionando.
 *
 * Expoe `globalThis.SQDealInfo = { mount, load, clear }`.
 */
(function () {
    'use strict';

    var FIELDS = "Owner,Submitted_by,Stage,Formula_19,Sales_person1,Student_Consultant,Contact_Pipeline," +
        "Days_on_This_stage,DSA,Speaking,All_Conditions_Met,Number_7,Important_Notes1,Contact_Name,Number_of_applications";
    var DSA_COLORS = { Yes: "#f00a30", No: "#67c480" }; // cores do picklist DSA no CRM
    var OPEN_KEY = "sqn-important-open";                // "1"/"0": aberto/fechado lembrado no navegador

    var badgesEl = null, boxEl = null, gridEl = null, impEl = null;
    var rec = null, deal = null, seq = 0, editingImp = false, impMsg = null;

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function button(cls, text, title) {
        var b = el("button", cls, text);
        b.type = "button";
        if (title) { b.title = title; b.setAttribute("aria-label", title); }
        return b;
    }

    // Icones em SVG inline, traco em currentColor: [tag, atributos] montados com createElementNS (sem innerHTML).
    var ICONS = {
        mic: [["path", { d: "M8 1.5a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0v-4a2 2 0 0 0-2-2Z" }], ["path", { d: "M4 7.5a4 4 0 0 0 8 0M8 11.5v3" }]],
        "case": [["rect", { x: "1.5", y: "4.5", width: "13", height: "9", rx: "1.5" }], ["path", { d: "M5.5 4.5v-1a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" }]],
        tick: [["path", { d: "m3 8.5 3 3 7-7" }]],
        warn: [["path", { d: "M8 1.8 15 14H1L8 1.8Z" }], ["path", { d: "M8 6.5v3.5M8 12v.01" }]],
        pencil: [["path", { d: "M11 2.5 13.5 5 5.5 13H3v-2.5L11 2.5Z" }]]
    };
    var SVG = "http://www.w3.org/2000/svg";
    function icon(nm) {
        var s = document.createElementNS(SVG, "svg");
        s.setAttribute("viewBox", "0 0 16 16");
        s.setAttribute("class", "sqn-ico");
        s.setAttribute("aria-hidden", "true");
        ICONS[nm].forEach(function (part) {
            var n = document.createElementNS(SVG, part[0]);
            Object.keys(part[1]).forEach(function (k) { n.setAttribute(k, part[1][k]); });
            s.appendChild(n);
        });
        return s;
    }

    function empty(v) { return v == null || v === "" || v === "-None-"; }
    function name(v) { return empty(v) ? "" : (typeof v === "object" ? (v.name || "") : String(v)); }

    /** Dias como inteiro, ou null. Formula do Zoho vem como double. */
    function days(v) {
        if (empty(v)) return null;
        var n = Number(v);
        return isFinite(n) ? Math.max(0, Math.floor(n)) : null;
    }

    /** Selo de dias: verde < 7, ambar 7-14, vermelho > 14. */
    function dayBadge(d, title) {
        var b = el("span", "sqn-days " + (d < 7 ? "sqn-days-ok" : d <= 14 ? "sqn-days-warn" : "sqn-days-late"), d + "d");
        b.title = title + ": " + d + (d === 1 ? " day" : " days");
        return b;
    }

    // ---------- montagem ----------
    /** `head`: linha do titulo; `after`: o contador "X notas"; `before`: onde a secao entra (a lista). */
    function mount(head, after, before) {
        badgesEl = el("span", "sqn-badges");
        head.insertBefore(badgesEl, after.nextSibling);
        boxEl = el("section", "sqn-deal");
        boxEl.setAttribute("aria-label", "Deal info");
        boxEl.hidden = true;
        gridEl = el("div", "sqn-grid");
        impEl = el("div", "sqn-imp-wrap");
        boxEl.appendChild(gridEl);
        boxEl.appendChild(impEl);
        before.parentNode.insertBefore(boxEl, before);
    }

    function clear() {
        seq++;
        rec = null; deal = null; editingImp = false; impMsg = null;
        if (!badgesEl) return;
        badgesEl.textContent = "";
        boxEl.hidden = true;
    }

    /** Carrega o Deal do registro aberto. `r` = { module, id }. Outro modulo: nada aparece. */
    async function load(r) {
        if (!badgesEl) return;
        if (!r || r.module !== "Deals") { clear(); return; }
        if (!rec || rec.id !== r.id) clear();
        var my = ++seq;
        rec = { module: r.module, id: r.id };
        if (!deal) {
            boxEl.hidden = false;
            gridEl.textContent = "";
            gridEl.appendChild(el("div", "sqn-deal-msg", "Loading deal info…"));
            impEl.textContent = "";
        }
        try {
            var body = await globalThis.SQZoho.get("/Deals/" + r.id + "?fields=" + FIELDS);
            var d = body && body.data && body.data[0];
            if (!d) throw new Error("deal não encontrado");
            var count = await countDeals(d);
            if (my !== seq) return;
            d.__count = count;
            deal = d;
            if (editingImp) renderTop(); else render();
        } catch (e) {
            if (my !== seq) return;
            deal = null;
            badgesEl.textContent = "";
            boxEl.hidden = false;
            gridEl.textContent = "";
            gridEl.appendChild(el("div", "sqn-deal-msg sqn-deal-err",
                "Deal info unavailable (" + e.message + "). The notes below still work."));
            impEl.textContent = "";
        }
    }

    /** Qnt. Deals: COQL pelo contato; recusada ou sem contato, cai para o campo "No. of apps". */
    async function countDeals(d) {
        var cid = d.Contact_Name && d.Contact_Name.id;
        if (cid && /^\d+$/.test(String(cid))) {
            try {
                var res = await globalThis.SQZoho.post("/coql", { select_query: "select COUNT(id) from Deals where Contact_Name = '" + cid + "'" });
                var row = res && res.data && res.data[0];
                var n = row ? Number(row["COUNT(id)"]) : NaN;
                if (isFinite(n) && n > 0) return n;
            } catch (e) { /* sem permissao de COQL: usa o campo */ }
        }
        if (empty(d.Number_of_applications)) return null;
        var f = Number(d.Number_of_applications);
        return isFinite(f) ? f : null;
    }

    // ---------- render ----------
    function pill(cls, iconName, label, value, title) {
        var p = el("span", "sqn-pill " + cls);
        p.title = title;
        if (iconName) p.appendChild(icon(iconName));
        if (label) p.appendChild(el("span", "sqn-pill-label", label));
        if (value != null) p.appendChild(el("span", "sqn-pill-value", value));
        return p;
    }

    function renderTop() {
        var d = deal;
        badgesEl.textContent = "";
        if (!empty(d.DSA)) {
            var dsa = pill("sqn-pill-dsa", null, "DSA", d.DSA, "DSA: " + d.DSA);
            dsa.style.background = DSA_COLORS[d.DSA] || "#6b7480";
            badgesEl.appendChild(dsa);
        }
        if (!empty(d.Speaking)) badgesEl.appendChild(pill("sqn-pill-speak", "mic", "Speaking", String(d.Speaking), "Speaking: " + d.Speaking));
        if (d.__count != null) badgesEl.appendChild(pill("sqn-pill-deals", "case", "Qnt. Deals", String(d.__count), "Deals for this contact: " + d.__count));
        if (!empty(d.All_Conditions_Met)) {
            var acm = pill("sqn-pill-acm", "tick", null, d.All_Conditions_Met, "All Conditions Met: " + d.All_Conditions_Met);
            var dn = days(d.Number_7);
            if (dn != null) {
                acm.appendChild(el("span", "sqn-pill-num", dn + "d"));
                acm.title += " · Days of Unco.: " + dn;
            }
            badgesEl.appendChild(acm);
        }
        gridEl.textContent = "";
        cell("Deal owner", name(d.Owner));
        cell("Submitted by", name(d.Submitted_by));
        cell("Stage", name(d.Stage), days(d.Formula_19), "Days on stage");
        cell("Student rep", name(d.Sales_person1));
        cell("Student consultant", name(d.Student_Consultant));
        cell("Assessment tracker", name(d.Contact_Pipeline), days(d.Days_on_This_stage), "Days on this stage");
        boxEl.hidden = false;
    }

    function render() { renderTop(); renderImportant(); }

    function cell(label, value, d, dTitle) {
        var c = el("div", "sqn-cell");
        c.appendChild(el("div", "sqn-cell-label", label));
        var v = el("div", "sqn-cell-value");
        var t = el("span", "sqn-cell-text", value || "-");
        if (value) t.title = value;
        v.appendChild(t);
        if (value && d != null) v.appendChild(dayBadge(d, dTitle));
        c.appendChild(v);
        gridEl.appendChild(c);
    }

    // ---------- Important notes ----------
    function prefOpen() {
        try { return localStorage.getItem(OPEN_KEY); } catch (e) { return null; }
    }
    function setPrefOpen(open) {
        try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (e) { /* storage bloqueado: vale so nesta tela */ }
    }

    function renderImportant() {
        impEl.textContent = "";
        var text = deal.Important_Notes1 || "";
        if (!text.trim() && !editingImp) {
            var add = button("sqn-imp-add", "+ Add important note", null);
            add.addEventListener("click", startEdit);
            impEl.appendChild(add);
            if (impMsg) impEl.appendChild(impMsg);
            return;
        }
        var open = editingImp || prefOpen() !== "0";
        var box = el("div", "sqn-imp" + (open ? "" : " sqn-imp-closed"));
        var bar = el("div", "sqn-imp-bar");
        var title = el("span", "sqn-imp-title");
        title.appendChild(icon("warn"));
        title.appendChild(el("span", null, "Important notes"));
        bar.appendChild(title);
        bar.appendChild(el("span", "sqn-spacer"));
        if (!editingImp) {
            var edit = button("sqn-imp-act sqn-imp-edit", null, "Edit important notes");
            edit.appendChild(icon("pencil"));
            edit.appendChild(el("span", null, "Edit"));
            edit.addEventListener("click", function (e) { e.stopPropagation(); startEdit(); });
            bar.appendChild(edit);
            var hide = button("sqn-imp-act sqn-imp-hide", open ? "▼ hide" : "▶ show", null);
            hide.setAttribute("aria-expanded", open ? "true" : "false");
            hide.setAttribute("aria-label", (open ? "Hide" : "Show") + " important notes");
            bar.appendChild(hide);
            // a barra inteira abre/fecha; o botao hide/show e o alvo de teclado
            bar.classList.add("sqn-imp-bar-click");
            bar.addEventListener("click", function () { setPrefOpen(!open); impMsg = null; renderImportant(); });
        }
        box.appendChild(bar);

        if (editingImp) {
            var ta = el("textarea", "sqn-imp-input");
            ta.value = text;
            ta.rows = 3;
            ta.setAttribute("aria-label", "Important notes");
            ta.maxLength = 32000;
            var row = el("div", "sqn-imp-row");
            var cancel = button("sqn-imp-cancel", "Cancel", null);
            var save = button("sqn-imp-save", "Save", null);
            cancel.addEventListener("click", function () { editingImp = false; impMsg = null; renderImportant(); });
            save.addEventListener("click", function () { saveImportant(ta, save, cancel); });
            ta.addEventListener("keydown", function (e) {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveImportant(ta, save, cancel); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel.click(); }
            });
            box.appendChild(ta);
            if (impMsg) box.appendChild(impMsg);
            row.appendChild(cancel);
            row.appendChild(save);
            box.appendChild(row);
            setTimeout(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
        } else if (open) {
            box.appendChild(el("div", "sqn-imp-text", text));
            if (impMsg) box.appendChild(impMsg);
        }
        impEl.appendChild(box);
    }

    function startEdit() {
        if (!deal) return;
        editingImp = true;
        impMsg = null;
        renderImportant();
    }

    async function saveImportant(ta, save, cancel) {
        if (!rec || save.disabled) return;
        var id = rec.id;
        var value = ta.value.replace(/\s+$/, "");
        save.disabled = cancel.disabled = true;
        save.textContent = "Saving…";
        try {
            await globalThis.SQZoho.put("/Deals/" + id, { data: [{ Important_Notes1: value }] });
            if (!rec || rec.id !== id) return;
            editingImp = false;
            impMsg = el("div", "sqn-imp-ok", value ? "Saved to Zoho." : "Important note removed in Zoho.");
            impMsg.setAttribute("role", "status");
            deal.Important_Notes1 = value;
            if (value) setPrefOpen(true);
            renderImportant();
            await load(rec); // le de novo do Zoho: o que aparece e o que ficou gravado
        } catch (e) {
            if (!rec || rec.id !== id) return;
            var keep = ta.value;
            impMsg = el("div", "sqn-imp-err", "Not saved. " + e.message + ". Your text is still in the box; try again.");
            impMsg.setAttribute("role", "alert");
            renderImportant();
            var nta = impEl.querySelector(".sqn-imp-input");
            if (nta) nta.value = keep;
        }
    }

    globalThis.SQDealInfo = { mount: mount, load: load, clear: clear };
})();
