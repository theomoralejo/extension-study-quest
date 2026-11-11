/**
 * notes-panel.js — painel lateral de notas em qualquer registro do Zoho CRM.
 *
 * Uma aba "Notas" fica presa na borda direita de toda pagina de registro
 * (Deal, Lead, Contact, modulo custom...). Ela abre um painel fixo, que segue
 * a rolagem, com todas as notas do registro e um editor (texto rico, titulo,
 * compartilhar com o cliente) para criar, editar e excluir notas do proprio
 * registro. Pedido do Mauro: comparar as notas com o resto da tela sem descer
 * e subir a pagina.
 *
 * Fonte: API de Notes do Zoho (v8: GET/POST /{modulo}/{id}/Notes,
 * PUT/DELETE /Notes/{id}), com a sessao da aba via `SQZoho`. Chamado pelo
 * observer unico do `content.js` via `tick()`.
 *
 * Expoe `globalThis.SQNotesPanel = { tick }`.
 */
(function () {
    'use strict';

    var FIELDS = "Note_Title,Note_Content,Created_Time,Created_By,Owner";
    var FIELDS_FULL = FIELDS + ",$is_shared_to_client"; // org sem portal pode recusar: cai para FIELDS
    var MAX_PAGES = 10; // 2000 notas: teto para nao varrer sem fim

    var current = null;    // { tab, module, id }
    var isOpen = false;
    var tab = null, panel = null, listEl = null, countEl = null, input = null, sendBtn = null, errEl = null;
    var titleInput = null, shareBox = null, statusEl = null, editBar = null, emojiBox = null;
    var toLeft = null, toRight = null, gripLeft = null, gripRight = null;
    var loadSeq = 0;
    var drafts = {};       // rascunho por registro: trocar de registro nao leva o texto junto
    var editing = null;    // nota em edicao: { id, author } ou null (criando nota nova)
    var savedRange = null; // ultima selecao dentro do editor, para cor, link e template

    var EMOJIS = "😀 😊 🙂 😉 😍 🤔 😅 😢 🙏 👍 👏 👋 💪 🎉 ✅ ❌ ⚠️ 📌 📎 📅 📞 📧 📄 ✈️ 🎓 💰 🏠 ⭐ ❤️ 🔥".split(" ");

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

    /** Conteudo de nota pode vir com HTML: vira texto puro, com quebra de linha por bloco, sem executar nada. */
    function plain(s) {
        if (!s) return "";
        if (s.indexOf("<") === -1) return s;
        var out = "";
        var nl = function () { if (out && out.slice(-1) !== "\n") out += "\n"; };
        (function walk(node) {
            node.childNodes.forEach(function (n) {
                if (n.nodeType === 3) { out += n.nodeValue; return; }
                if (n.nodeType !== 1 || DROP[n.tagName]) return;
                if (n.tagName === "BR") { out += "\n"; return; }
                var block = /^(DIV|P|LI|UL|OL|BLOCKQUOTE)$/.test(n.tagName);
                if (block) nl();
                walk(n);
                if (block) nl();
            });
        })(new DOMParser().parseFromString(s, "text/html").body);
        return out.replace(/\n{3,}/g, "\n\n").trim();
    }

    // ---------- HTML seguro ----------
    // Lista branca: so formatacao do editor do Zoho. Tag fora dela perde a tag e fica com o texto;
    // script/style/iframe somem inteiros. Atributo nenhum passa, exceto cor, recuo e link http(s)/mailto.
    var KEEP = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, SUB: 1, SUP: 1, BR: 1, P: 1, DIV: 1,
        UL: 1, OL: 1, LI: 1, A: 1, SPAN: 1, FONT: 1, BLOCKQUOTE: 1 };
    var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1, MATH: 1, LINK: 1, META: 1 };

    function cleanInto(src, dst) {
        src.childNodes.forEach(function (n) {
            if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
            if (n.nodeType !== 1 || DROP[n.tagName]) return;
            if (!KEEP[n.tagName]) { cleanInto(n, dst); return; }
            var out = document.createElement(n.tagName === "FONT" ? "span" : n.tagName.toLowerCase());
            var color = n.style.color || (n.tagName === "FONT" && n.getAttribute("color")) || "";
            if (color) out.style.color = color;
            if (n.style.backgroundColor) out.style.backgroundColor = n.style.backgroundColor;
            if (n.style.marginLeft) out.style.marginLeft = n.style.marginLeft;
            if (n.style.paddingLeft) out.style.paddingLeft = n.style.paddingLeft;
            ["fontWeight", "fontStyle", "textDecorationLine", "verticalAlign"].forEach(function (k) { if (n.style[k]) out.style[k] = n.style[k]; });
            if (n.tagName === "A") {
                var href = (n.getAttribute("href") || "").trim();
                if (/^(https?:|mailto:)/i.test(href)) { out.href = href; out.target = "_blank"; out.rel = "noopener noreferrer"; }
            }
            cleanInto(n, out);
            dst.appendChild(out);
        });
    }

    /** HTML de fora (nota do Zoho, colagem) -> fragmento so com a lista branca. */
    function safeFragment(html) {
        var doc = new DOMParser().parseFromString(html || "", "text/html");
        var frag = document.createDocumentFragment();
        cleanInto(doc.body, frag);
        return frag;
    }

    function safeHtml(html) {
        var box = document.createElement("div");
        box.appendChild(safeFragment(html));
        return box.innerHTML;
    }

    /** Tem formatacao alem de quebra de linha? Sem ela a nota sai como texto puro, como antes. */
    function isRich(html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        return Array.prototype.some.call(doc.body.querySelectorAll("*"), function (n) {
            return !/^(DIV|P|BR)$/.test(n.tagName) || n.getAttribute("style");
        });
    }

    function fmtDate(iso) {
        var d = new Date(iso);
        if (isNaN(d)) return "";
        return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    async function resolveModule(tabName) {
        return (await globalThis.SQZoho.module(tabName)).api;
    }

    // ---------- editor de texto rico ----------
    function saveRange() {
        var sel = window.getSelection();
        if (sel.rangeCount && input.contains(sel.getRangeAt(0).commonAncestorContainer)) savedRange = sel.getRangeAt(0).cloneRange();
    }

    /** Devolve o cursor ao editor: onde estava, ou no fim do texto. */
    function restoreRange() {
        input.focus();
        var sel = window.getSelection();
        sel.removeAllRanges();
        if (savedRange && input.contains(savedRange.commonAncestorContainer)) { sel.addRange(savedRange); return; }
        var r = document.createRange();
        r.selectNodeContents(input);
        r.collapse(false);
        sel.addRange(r);
    }

    function exec(cmd, arg) {
        restoreRange();
        // so as cores precisam de span com estilo; o resto sai em tag (<b>, <i>...), como no Zoho
        document.execCommand("styleWithCSS", false, cmd === "foreColor" || cmd === "hiliteColor");
        document.execCommand(cmd, false, arg == null ? null : arg);
        saveRange();
        syncToolbar();
        syncSend();
    }

    var stateBtns = [];
    function syncToolbar() {
        stateBtns.forEach(function (b) {
            var on = false;
            try { on = document.queryCommandState(b.dataset.cmd); } catch (e) { on = false; }
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    function buildToolbar() {
        var bar = el("div", "sqn-toolbar");
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", "Formatação do texto");
        // mousedown sem default: o clique no botao nao tira a selecao do editor
        bar.addEventListener("mousedown", function (e) { if (e.target.closest("button")) e.preventDefault(); });

        function group() { var g = el("div", "sqn-tool-group"); bar.appendChild(g); return g; }
        function cmdBtn(g, cmd, text, title, cls, stateful) {
            var b = button("sqn-tool " + (cls || ""), text, title);
            b.dataset.cmd = cmd;
            b.addEventListener("click", function () { exec(cmd); });
            if (stateful) { b.setAttribute("aria-pressed", "false"); stateBtns.push(b); }
            g.appendChild(b);
            return b;
        }
        function colorBtn(g, cmd, cls, title, initial) {
            var wrap = el("label", "sqn-tool sqn-tool-color " + cls);
            wrap.title = title;
            wrap.appendChild(el("span", null, "A"));
            var pick = el("input");
            pick.type = "color";
            pick.value = initial;
            pick.setAttribute("aria-label", title);
            pick.addEventListener("mousedown", saveRange);
            pick.addEventListener("change", function () { wrap.style.setProperty("--sqn-pick", pick.value); exec(cmd, pick.value); });
            wrap.style.setProperty("--sqn-pick", initial);
            wrap.appendChild(pick);
            g.appendChild(wrap);
        }

        var g1 = group();
        cmdBtn(g1, "bold", "B", "Negrito (Ctrl/⌘ + B)", "sqn-t-b", true);
        cmdBtn(g1, "italic", "I", "Itálico (Ctrl/⌘ + I)", "sqn-t-i", true);
        cmdBtn(g1, "underline", "U", "Sublinhado (Ctrl/⌘ + U)", "sqn-t-u", true);
        cmdBtn(g1, "strikeThrough", "S", "Tachado", "sqn-t-s", true);
        var g2 = group();
        colorBtn(g2, "foreColor", "sqn-t-fore", "Cor do texto", "#E95320");
        colorBtn(g2, "hiliteColor", "sqn-t-back", "Cor de fundo", "#FFF3A3");
        var g3 = group();
        cmdBtn(g3, "insertUnorderedList", "•≡", "Lista com marcadores", null, true);
        cmdBtn(g3, "insertOrderedList", "1≡", "Lista numerada", null, true);
        var link = button("sqn-tool", "Link", "Inserir link");
        link.addEventListener("click", function () {
            saveRange();
            var url = window.prompt("Endereço do link (https://…):", "https://");
            if (!url) return;
            url = url.trim();
            if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
            var sel = savedRange && !savedRange.collapsed;
            if (sel) exec("createLink", url); else exec("insertHTML", '<a href="' + url.replace(/"/g, "%22") + '">' + url.replace(/</g, "&lt;") + "</a>");
        });
        g3.appendChild(link);
        var g4 = group();
        cmdBtn(g4, "indent", "⇥", "Aumentar recuo");
        cmdBtn(g4, "outdent", "⇤", "Diminuir recuo");
        var g5 = group();
        cmdBtn(g5, "subscript", "x₂", "Subscrito", null, true);
        cmdBtn(g5, "superscript", "x²", "Sobrescrito", null, true);
        var g6 = group();
        var emo = button("sqn-tool", "☺︎", "Emoji");
        emo.setAttribute("aria-haspopup", "true");
        emo.setAttribute("aria-expanded", "false");
        emojiBox = el("div", "sqn-emoji");
        emojiBox.hidden = true;
        EMOJIS.forEach(function (ch) {
            var b = button("sqn-emoji-btn", ch, null);
            b.setAttribute("aria-label", ch);
            b.addEventListener("click", function () { toggleEmoji(emo, false); exec("insertText", ch); });
            emojiBox.appendChild(b);
        });
        emo.addEventListener("click", function () { toggleEmoji(emo, emojiBox.hidden); });
        g6.appendChild(emo);
        g6.appendChild(emojiBox);
        cmdBtn(g6, "removeFormat", "T̸", "Limpar formatação", "sqn-t-clear");
        return bar;
    }

    function toggleEmoji(btn, open) {
        emojiBox.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
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
        head.appendChild(el("span", "sqn-spacer"));
        toLeft = button("sqn-icon-btn", "←", "Encostar o painel na esquerda");
        toRight = button("sqn-icon-btn", "→", "Encostar o painel na direita");
        toLeft.addEventListener("click", function () { dockTo("left"); });
        toRight.addEventListener("click", function () { dockTo("right"); });
        head.appendChild(toLeft);
        head.appendChild(toRight);
        var refresh = button("sqn-icon-btn", "↻", "Recarregar notas");
        refresh.addEventListener("click", function () { load(); });
        var close = button("sqn-icon-btn", "✕", "Recolher painel de notas");
        close.addEventListener("click", function () { setOpen(false); });
        head.appendChild(refresh);
        head.appendChild(close);

        listEl = el("div", "sqn-list");
        listEl.setAttribute("aria-live", "polite");

        statusEl = el("div", "sqn-status");
        statusEl.setAttribute("role", "status");
        statusEl.hidden = true;

        var form = el("form", "sqn-compose");
        editBar = el("div", "sqn-editbar");
        editBar.hidden = true;

        titleInput = el("input", "sqn-title-input");
        titleInput.type = "text";
        titleInput.placeholder = "Título (opcional)";
        titleInput.setAttribute("aria-label", "Título da nota");
        titleInput.maxLength = 120;
        titleInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); if (e.metaKey || e.ctrlKey) send(); else restoreRange(); }
        });

        input = el("div", "sqn-input");
        input.contentEditable = "true";
        input.setAttribute("role", "textbox");
        input.setAttribute("aria-multiline", "true");
        input.setAttribute("aria-label", "Texto da nota");
        input.dataset.placeholder = "Escreva uma nota…";
        input.addEventListener("input", function () { statusEl.hidden = true; syncSend(); });
        input.addEventListener("keyup", function () { saveRange(); syncToolbar(); });
        input.addEventListener("mouseup", function () { saveRange(); syncToolbar(); });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
        });
        // Colar: so a formatacao da lista branca entra no editor.
        input.addEventListener("paste", function (e) {
            var data = e.clipboardData;
            if (!data) return;
            e.preventDefault();
            var html = data.getData("text/html");
            if (html) document.execCommand("insertHTML", false, safeHtml(html));
            else document.execCommand("insertText", false, data.getData("text/plain"));
        });

        var editorBox = el("div", "sqn-editor");
        editorBox.appendChild(buildToolbar());
        editorBox.appendChild(input);

        var row = el("div", "sqn-compose-row");
        var left = el("div", "sqn-compose-left");
        var qr = el("button", "sqn-qr");
        qr.type = "button";
        qr.title = "Templates (respostas rápidas)";
        qr.setAttribute("aria-label", "Inserir template");
        qr.setAttribute("aria-haspopup", "dialog");
        var qrImg = el("img");
        qrImg.src = globalThis.SQBrowser.getURL("icons/icon16.png");
        qrImg.alt = "";
        qr.appendChild(qrImg);
        qr.addEventListener("mousedown", saveRange);
        qr.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!globalThis.SQQuickReplies) return;
            globalThis.SQQuickReplies.toggle(qr, insertTemplate);
        });
        left.appendChild(qr);
        var share = el("label", "sqn-share");
        shareBox = el("input");
        shareBox.type = "checkbox";
        share.appendChild(shareBox);
        share.appendChild(el("span", null, "Compartilhar com o cliente"));
        share.title = "Share to customer: a nota fica visível para o cliente no portal do Zoho";
        left.appendChild(share);
        row.appendChild(left);
        sendBtn = el("button", "sqn-send", "Adicionar nota");
        sendBtn.type = "submit";
        row.appendChild(sendBtn);

        errEl = el("div", "sqn-error-inline");
        errEl.setAttribute("role", "alert");
        errEl.hidden = true;

        form.appendChild(editBar);
        form.appendChild(titleInput);
        form.appendChild(editorBox);
        form.appendChild(errEl);
        form.appendChild(row);
        form.appendChild(el("div", "sqn-hint", "Ctrl/⌘ + Enter salva"));
        form.addEventListener("submit", function (e) { e.preventDefault(); send(); });

        panel.dataset.sqDock = "right";
        gripLeft = el("div", "sqn-grip sqn-grip-left");
        gripRight = el("div", "sqn-grip sqn-grip-right");
        [gripLeft, gripRight].forEach(function (g) { g.title = "Arraste para mudar o tamanho"; g.setAttribute("aria-hidden", "true"); });
        var drag = globalThis.SQDrag;
        if (drag) {
            drag.attach(panel, head, "notes", { keepHeight: true, maxHeight: 0.8, onMove: syncTab, onReset: syncTab });
            drag.attachResize(panel, gripLeft, "notes", "left", { onMove: syncTab });
            drag.attachResize(panel, gripRight, "notes", "right", { onMove: syncTab });
            drag.attachEdge(tab, "notesTab");
            window.addEventListener("resize", function () { drag.clamp(panel, "notes"); syncTab(); });
        }
        panel.appendChild(gripLeft);
        panel.appendChild(gripRight);

        panel.appendChild(head);
        panel.appendChild(listEl);
        panel.appendChild(statusEl);
        panel.appendChild(form);
        document.body.appendChild(panel);
        document.body.appendChild(tab);
        syncSend();
        restoreFlow();
        window.addEventListener("pagehide", saveDrafts);

        document.addEventListener("keydown", function (e) {
            if (e.key !== "Escape" || !isOpen || !panel.contains(document.activeElement)) return;
            if (!emojiBox.hidden) { toggleEmoji(panel.querySelector('[aria-haspopup="true"]'), false); return; }
            if (editing) { stopEditing(); return; }
            setOpen(false);
        });
        document.addEventListener("selectionchange", function () { if (document.activeElement === input) syncToolbar(); });
        document.addEventListener("mousedown", function (e) {
            if (!emojiBox.hidden && !e.target.closest(".sqn-emoji, [aria-haspopup=\"true\"]")) toggleEmoji(panel.querySelector('[aria-haspopup="true"]'), false);
        });
    }

    /** Template escolhido: texto entra onde esta o cursor; o titulo vira o titulo da nota. */
    function insertTemplate(title, text) {
        exec("insertText", text);
        setTitle(title || "");
    }

    function setTitle(title) { titleInput.value = title; }

    function editorEmpty() { return !input.textContent.trim() && !input.querySelector("li"); }

    function setEditor(html) {
        input.textContent = "";
        if (!html) return;
        if (html.indexOf("<") === -1) {
            // texto puro do Zoho: quebra de linha vira <br>
            html.split("\n").forEach(function (line, i) {
                if (i) input.appendChild(document.createElement("br"));
                input.appendChild(document.createTextNode(line));
            });
        } else {
            input.appendChild(safeFragment(html));
        }
        savedRange = null;
    }

    function syncSend() {
        if (sendBtn) sendBtn.disabled = editorEmpty() || sendBtn.dataset.busy === "1";
    }

    function setOpen(open) {
        isOpen = open;
        panel.hidden = !open;
        tab.setAttribute("aria-expanded", open ? "true" : "false");
        tab.classList.toggle("sqn-tab-open", open);
        var flow = {}; flow[OPEN_KEY] = open;
        globalThis.SQBrowser.storageSet(flow);
        if (open) {
            load();
            restoreRange();
            if (globalThis.SQDrag) globalThis.SQDrag.restore(panel, "notes").then(syncTab);
        } else {
            saveDrafts();
        }
        syncTab();
    }

    /**
     * A aba acompanha o painel: aberta, encosta do lado de fora dele (onde ele
     * estiver); recolhida, volta para a borda direita na altura que a pessoa escolheu.
     */
    function syncTab() {
        if (!tab) return;
        var drag = globalThis.SQDrag;
        syncDock();
        tab.dataset.sqFixed = isOpen ? "1" : "0";
        if (!isOpen || !drag || (!panel.style.left && !panel.style.width)) { // painel no lugar padrao: CSS cuida da aba
            tab.style.left = "";
            tab.style.right = "";
            var edge = !isOpen && drag && drag.saved("notesTab");
            tab.style.top = edge ? Math.max(12, Math.min(edge.top, document.documentElement.clientHeight - tab.offsetHeight - 12)) + "px" : "";
            return;
        }
        var p = panel.getBoundingClientRect();
        var w = tab.offsetWidth;
        var left = p.left - w >= 0 ? p.left - w : Math.min(p.right, document.documentElement.clientWidth - w);
        tab.style.right = "auto";
        tab.style.left = left + "px";
        tab.style.top = (p.top + 16) + "px";
    }

    /** Setas e cantos so onde levam a algum lugar: encostado a direita vai para a esquerda, e vice-versa; solto, os dois. */
    function syncDock() {
        var side = panel.dataset.sqDock || "";
        toLeft.hidden = side === "left";
        toRight.hidden = side === "right";
        gripLeft.hidden = side === "left";
        gripRight.hidden = side === "right";
    }

    function dockTo(side) {
        if (!globalThis.SQDrag) return;
        globalThis.SQDrag.dock(panel, "notes", side);
        syncTab();
        (side === "left" ? toRight : toLeft).focus();
    }

    // ---------- o fluxo sobrevive a recolher, trocar de pagina e recarregar ----------
    var OPEN_KEY = "sqnOpen";
    var DRAFTS_KEY = "sqn-drafts";

    function saveDrafts() {
        if (!input || !current) return;
        if (!editing) drafts[current.id] = { title: titleInput.value, html: input.innerHTML, shared: shareBox.checked };
        try {
            var keep = {};
            Object.keys(drafts).forEach(function (id) {
                var d = drafts[id];
                if (id !== "__beforeEdit" && d && (d.title || (d.html && d.html !== "<br>"))) keep[id] = d;
            });
            sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(keep));
        } catch (e) { /* sessionStorage bloqueado: rascunho fica so em memoria */ }
    }

    /** Rascunhos da aba (sessionStorage) e painel aberto/recolhido como a pessoa deixou. */
    function restoreFlow() {
        try {
            var saved = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || "{}");
            Object.keys(saved).forEach(function (id) { if (!drafts[id]) drafts[id] = saved[id]; });
        } catch (e) { /* sem rascunho salvo */ }
        globalThis.SQBrowser.storageGet([OPEN_KEY]).then(function (r) {
            if (r && r[OPEN_KEY] && !isOpen && current) setOpen(true);
        });
        if (globalThis.SQDrag) globalThis.SQDrag.ready.then(syncTab);
    }

    // ---------- edicao ----------
    function startEditing(n) {
        if (!editing) drafts.__beforeEdit = { title: titleInput.value, html: input.innerHTML, shared: shareBox.checked };
        editing = { id: n.id };
        editBar.textContent = "";
        editBar.appendChild(el("span", null, "Editando a nota de " + noteAuthor(n)));
        var cancel = button("sqn-link-btn", "Cancelar edição", null);
        cancel.addEventListener("click", stopEditing);
        editBar.appendChild(cancel);
        editBar.hidden = false;
        setTitle(n.Note_Title || "");
        setEditor(n.Note_Content || "");
        shareBox.checked = !!n.$is_shared_to_client;
        sendBtn.textContent = "Salvar alteração";
        errEl.hidden = true;
        statusEl.hidden = true;
        syncSend();
        restoreRange();
    }

    /** Sai da edicao e devolve o rascunho que existia antes dela. */
    function stopEditing() {
        var before = drafts.__beforeEdit || { title: "", html: "", shared: false };
        delete drafts.__beforeEdit;
        editing = null;
        editBar.hidden = true;
        setTitle(before.title);
        setEditor(before.html);
        shareBox.checked = before.shared;
        sendBtn.textContent = "Adicionar nota";
        errEl.hidden = true;
        syncSend();
    }

    // ---------- estados da lista ----------
    function showMessage(cls, text, retry) {
        listEl.textContent = "";
        var box = el("div", cls);
        box.appendChild(el("p", null, text));
        if (retry) {
            var b = button("sqn-retry", "Tentar de novo", null);
            b.addEventListener("click", function () { load(); });
            box.appendChild(b);
        }
        listEl.appendChild(box);
    }

    function noteAuthor(n) {
        return (n.Created_By && n.Created_By.name) || (n.Owner && n.Owner.name) || "—";
    }

    function noteBody(n) {
        var c = n.Note_Content || "";
        var body;
        if (c.indexOf("<") === -1) body = el("div", "sqn-body", c);
        else { body = el("div", "sqn-body sqn-body-html"); body.appendChild(safeFragment(c)); }
        markMentions(body);
        return body;
    }

    // ---------- mencoes (@pessoa) ----------
    // A doc da API nao descreve como a mencao vem no Note_Content. Cobre as tres formas
    // possiveis: link cujo texto comeca com @, o codigo crm[user#id#...]crm e @Nome de um usuario do Zoho.
    // Mencao vira nome em negrito e azul, sem link.
    var usersPromise = null;
    function zohoUsers() {
        if (!usersPromise) {
            usersPromise = globalThis.SQZoho.get("/users?type=AllUsers&per_page=200").then(function (b) {
                return (b.users || []).map(function (u) {
                    return { id: String(u.id), name: u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") };
                }).filter(function (u) { return u.name; });
            }).catch(function () { usersPromise = null; return []; });
        }
        return usersPromise;
    }

    function mention(name) { return el("span", "sqn-mention", "@" + name.replace(/^@/, "")); }

    var CODE_RE = /crm\[user#(\d+)#[^\]]*\]crm/;
    function markMentions(body) {
        body.querySelectorAll("a").forEach(function (a) {
            var t = a.textContent.trim();
            if (t.charAt(0) === "@") a.replaceWith(mention(t));
        });
        var hasCode = CODE_RE.test(body.textContent);
        if (!hasCode && body.textContent.indexOf("@") === -1) return;
        zohoUsers().then(function (users) {
            var byId = {};
            users.forEach(function (u) { byId[u.id] = u.name; });
            var names = users.map(function (u) { return u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); })
                .sort(function (a, b) { return b.length - a.length; });
            // @ grudado em letra antes e e-mail, nao mencao
            var re = new RegExp(CODE_RE.source + (names.length ? "|(^|[^\\w@.])@(" + names.join("|") + ")(?![\\w])" : ""), "gi");
            var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
            var nodes = [];
            while (walker.nextNode()) if (!walker.currentNode.parentNode.closest(".sqn-mention")) nodes.push(walker.currentNode);
            nodes.forEach(function (node) {
                var text = node.nodeValue, frag = null, last = 0, m;
                re.lastIndex = 0;
                while ((m = re.exec(text))) {
                    frag = frag || document.createDocumentFragment();
                    var start = m.index + (m[2] ? m[2].length : 0);
                    frag.appendChild(document.createTextNode(text.slice(last, start)));
                    frag.appendChild(mention(m[1] ? (byId[m[1]] || "usuário do Zoho") : m[3]));
                    last = m.index + m[0].length;
                }
                if (!frag) return;
                frag.appendChild(document.createTextNode(text.slice(last)));
                node.replaceWith(frag);
            });
        });
    }

    /** Excluir pede confirmacao no proprio cartao, dizendo qual nota some. */
    function askDelete(item, n) {
        var bar = item.querySelector(".sqn-actions");
        bar.textContent = "";
        bar.classList.add("sqn-confirm");
        var what = n.Note_Title || plain(n.Note_Content).slice(0, 40) || "esta nota";
        bar.appendChild(el("span", "sqn-confirm-text", "Excluir “" + what + "”? Some do Zoho para todos e não dá para desfazer."));
        var yes = button("sqn-danger", "Excluir nota", null);
        var no = button("sqn-link-btn", "Cancelar", null);
        no.addEventListener("click", function () { renderActions(item, n); });
        yes.addEventListener("click", async function () {
            yes.disabled = true;
            yes.textContent = "Excluindo…";
            try {
                await globalThis.SQZoho.del("/Notes/" + n.id);
                if (editing && editing.id === n.id) stopEditing();
                showStatus("Nota excluída do Zoho.");
                await load();
            } catch (e) {
                renderActions(item, n);
                item.querySelector(".sqn-actions").appendChild(el("div", "sqn-error-inline", "A nota não foi excluída. " + e.message + "."));
            }
        });
        bar.appendChild(yes);
        bar.appendChild(no);
        no.focus();
    }

    function renderActions(item, n) {
        var bar = item.querySelector(".sqn-actions");
        bar.textContent = "";
        bar.classList.remove("sqn-confirm");
        if (n.$editable === false) return; // o Zoho nao deixa este usuario mexer: nada a oferecer
        bar.appendChild(el("span", "sqn-spacer"));
        var edit = button("sqn-link-btn", "Editar", null);
        edit.addEventListener("click", function () { startEditing(n); });
        var del = button("sqn-link-btn sqn-link-danger", "Excluir", null);
        del.addEventListener("click", function () { askDelete(item, n); });
        bar.appendChild(edit);
        bar.appendChild(del);
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
            if (editing && editing.id === n.id) item.classList.add("sqn-note-editing");
            var meta = el("div", "sqn-meta");
            meta.appendChild(el("span", "sqn-author", noteAuthor(n)));
            // fica no cabecalho do cartao: confirmar exclusao ou editar nao some com o selo
            if (n.$is_shared_to_client) meta.appendChild(el("span", "sqn-badge", "Visível no portal do cliente"));
            meta.appendChild(el("time", "sqn-date", fmtDate(n.Created_Time)));
            item.appendChild(meta);
            if (n.Note_Title) item.appendChild(el("div", "sqn-note-title", n.Note_Title));
            item.appendChild(noteBody(n));
            item.appendChild(el("div", "sqn-actions"));
            renderActions(item, n);
            listEl.appendChild(item);
        });
    }

    async function fetchPages(rec, fields) {
        var all = [];
        for (var page = 1; page <= MAX_PAGES; page++) {
            var q = new URLSearchParams({ fields: fields, per_page: 200, page: page });
            var body = await globalThis.SQZoho.get("/" + rec.module + "/" + rec.id + "/Notes?" + q);
            all = all.concat(body.data || []);
            if (!(body.info && body.info.more_records)) break;
        }
        return all;
    }

    async function fetchNotes(rec) {
        var all;
        try { all = await fetchPages(rec, FIELDS_FULL); } catch (e) { all = await fetchPages(rec, FIELDS); }
        // A API devolve da mais antiga para a mais nova; o painel mostra a mais nova no topo.
        all.sort(function (a, b) { return new Date(b.Created_Time) - new Date(a.Created_Time); });
        return all;
    }

    async function load() {
        if (!current || !panel) return;
        var seq = ++loadSeq;
        var keepScroll = listEl.dataset.rec === current.id ? listEl.scrollTop : 0;
        var hadNotes = listEl.dataset.rec === current.id && listEl.querySelector(".sqn-note");
        if (!hadNotes) {
            countEl.textContent = "";
            showMessage("sqn-loading", "Carregando notas…");
        }
        try {
            current.module = await resolveModule(current.tab);
            var notes = await fetchNotes(current);
            if (seq !== loadSeq) return;
            render(notes);
            listEl.dataset.rec = current.id;
            listEl.scrollTop = keepScroll;
        } catch (e) {
            if (seq !== loadSeq) return;
            showMessage("sqn-error",
                "Não foi possível carregar as notas. " + e.message +
                ". Confira se você ainda está logado no Zoho e tente de novo.", true);
        }
    }

    /**
     * Gravou pela API: a lista de notas da propria pagina do Zoho nao fica sabendo
     * e so mostra a mudanca depois de recarregar. O aviso diz isso e oferece o botao.
     */
    function showStatus(text) {
        statusEl.textContent = "";
        statusEl.appendChild(el("span", null, text + " A lista de notas da página do Zoho só mostra a mudança depois de recarregar."));
        var reload = button("sqn-link-btn", "Recarregar página", null);
        reload.addEventListener("click", function () { location.reload(); });
        statusEl.appendChild(reload);
        statusEl.hidden = false;
    }

    async function send() {
        if (editorEmpty() || !current || sendBtn.dataset.busy === "1") return;
        var html = safeHtml(input.innerHTML);
        var content = isRich(html) ? html : plain(html);
        var label = editing ? "Salvar alteração" : "Adicionar nota";
        sendBtn.dataset.busy = "1";
        sendBtn.textContent = "Salvando…";
        errEl.hidden = true;
        syncSend();
        try {
            current.module = await resolveModule(current.tab);
            var title = titleInput.value.trim();
            if (editing) {
                await globalThis.SQZoho.put("/Notes/" + editing.id, {
                    data: [{ Note_Title: title, Note_Content: content, $is_shared_to_client: shareBox.checked }]
                });
                delete drafts.__beforeEdit; // a edicao foi salva: volta para o campo vazio
                stopEditing();
                showStatus("Alteração salva no Zoho.");
            } else {
                var note = {
                    Note_Content: content,
                    Parent_Id: { module: { api_name: current.module }, id: current.id }
                };
                if (title) note.Note_Title = title;
                if (shareBox.checked) note.$is_shared_to_client = true;
                await globalThis.SQZoho.post("/" + current.module + "/" + current.id + "/Notes", { data: [note] });
                setEditor("");
                setTitle("");
                shareBox.checked = false;
                delete drafts[current.id];
                showStatus("Nota salva no Zoho.");
            }
            label = editing ? "Salvar alteração" : "Adicionar nota";
            await load();
        } catch (e) {
            // O texto fica no campo: nada do que a pessoa escreveu se perde.
            errEl.textContent = "A nota não foi salva. " + e.message + ". O texto continua no campo; tente de novo.";
            errEl.hidden = false;
        } finally {
            sendBtn.dataset.busy = "0";
            sendBtn.textContent = label;
            syncSend();
        }
    }

    // ---------- troca de pagina ----------
    var lastUrl = "";
    function tick() {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        var rec = globalThis.SQZoho.recordFromUrl();
        if (!rec) {
            current = null;
            if (tab) { tab.hidden = true; panel.hidden = true; }
            return;
        }
        if (current && current.id === rec.id) return;
        if (tab && editing) stopEditing(); // edicao e do registro anterior: nao vira rascunho
        if (current && input) drafts[current.id] = { title: titleInput.value, html: input.innerHTML, shared: shareBox.checked };
        current = { tab: rec.tab, module: null, id: rec.id };
        if (!tab) build();
        var draft = drafts[rec.id] || { title: "", html: "", shared: false };
        setEditor(draft.html);
        setTitle(draft.title);
        shareBox.checked = draft.shared;
        syncSend();
        tab.hidden = false;
        errEl.hidden = true;
        statusEl.hidden = true;
        if (isOpen) { panel.hidden = false; load(); }
        syncTab();
    }

    globalThis.SQNotesPanel = { tick: tick };
})();
