/**
 * drag.js — paineis arrastaveis pelo cabecalho, com a posicao lembrada.
 *
 * A posicao fica no storage da extensao (uma chave por painel), gravada so ao
 * soltar: arrastar nao gera escrita por movimento. Toda posicao e limitada a
 * viewport, inclusive a salva quando a janela encolheu desde entao.
 * Duplo clique no cabecalho volta o painel ao lugar padrao.
 *
 * Expoe `globalThis.SQDrag = { attach, attachEdge, restore, clamp, saved, ready }`.
 */
(function () {
    'use strict';

    var SQ = globalThis.SQBrowser;
    var MARGIN = 12;
    var KEY = 'sqPanelPos';
    var cache = null; // { [nome]: { left, top, height? } }
    var loading = SQ.storageGet([KEY]).then(function (r) { cache = (r && r[KEY]) || {}; return cache; });

    function viewport() {
        return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    }

    /** Coloca `el` em (left, top) sem sair da tela. */
    function place(el, left, top, height) {
        var vp = viewport();
        if (height) el.style.height = Math.min(height, vp.h - 2 * MARGIN) + 'px';
        var r = el.getBoundingClientRect();
        left = Math.max(MARGIN, Math.min(left, vp.w - r.width - MARGIN));
        top = Math.max(MARGIN, Math.min(top, vp.h - r.height - MARGIN));
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        return { left: left, top: top };
    }

    /** Reaplica a posicao salva de `name` em `el`. Resolve true se havia uma. */
    function restore(el, name) {
        return loading.then(function () {
            var pos = cache[name];
            if (!pos || !el.isConnected) return false;
            place(el, pos.left, pos.top, pos.height);
            return true;
        });
    }

    /** Depois de um resize: puxa de volta para a tela o painel ja posicionado. */
    function clamp(el, name) {
        var pos = cache && cache[name];
        if (pos && el.isConnected && !el.hidden) place(el, pos.left, pos.top, pos.height);
    }

    function save(name, pos) {
        if (!cache) return;
        if (pos) cache[name] = pos; else delete cache[name];
        var items = {};
        items[KEY] = cache;
        SQ.storageSet(items);
    }

    /**
     * Torna `el` arrastavel por `handle`. Botoes e campos dentro do cabecalho
     * continuam clicaveis. `opts.keepHeight` grava a altura junto (painel que
     * por padrao ocupa a tela de cima a baixo); `opts.maxHeight` (fracao da
     * tela) limita essa altura quando o painel e solto. `opts.onReset` recoloca o
     * painel no lugar padrao depois do duplo clique.
     */
    function attach(el, handle, name, opts) {
        opts = opts || {};
        handle.classList.add('sq-drag-handle');
        handle.title = handle.title || 'Arraste para mover · duplo clique volta ao lugar padrão';

        handle.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, label')) return;
            var r = el.getBoundingClientRect();
            var dx = e.clientX - r.left, dy = e.clientY - r.top;
            // Painel de altura cheia nao teria para onde descer: solto, fica com no maximo `maxHeight` da tela.
            var height = opts.keepHeight ? Math.min(r.height, opts.maxHeight ? viewport().h * opts.maxHeight : r.height) : null;
            var last = null;
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            el.classList.add('sq-dragging');

            function move(ev) {
                last = place(el, ev.clientX - dx, ev.clientY - dy, height);
                if (opts.onMove) opts.onMove();
            }
            function up() {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                el.classList.remove('sq-dragging');
                if (!last) return; // so clicou: nada a gravar
                if (height) last.height = height;
                save(name, last);
            }
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        });

        handle.addEventListener('dblclick', function (e) {
            if (e.target.closest('button, input, select, textarea, a, label')) return;
            ['left', 'top', 'right', 'bottom', 'height'].forEach(function (p) { el.style[p] = ''; });
            save(name, null);
            if (opts.onReset) opts.onReset();
        });
    }

    /**
     * Aba encostada na borda: arrasta so na vertical e continua sendo botao.
     * Movimento acima de 4px vira arraste e o clique daquele gesto e anulado.
     * `data-sq-fixed="1"` desliga o arraste (aba presa ao painel aberto).
     */
    function attachEdge(el, name) {
        var dragged = false;
        el.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 || el.dataset.sqFixed === '1') return;
            var r = el.getBoundingClientRect();
            var startY = e.clientY, dy = e.clientY - r.top, last = null;
            dragged = false;
            el.setPointerCapture(e.pointerId);
            function move(ev) {
                if (!dragged && Math.abs(ev.clientY - startY) < 4) return;
                dragged = true;
                var vp = viewport();
                var top = Math.max(MARGIN, Math.min(ev.clientY - dy, vp.h - r.height - MARGIN));
                el.style.top = top + 'px';
                last = { top: top };
            }
            function up() {
                el.removeEventListener('pointermove', move);
                el.removeEventListener('pointerup', up);
                el.removeEventListener('pointercancel', up);
                if (last) save(name, last);
            }
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        });
        el.addEventListener('click', function (e) {
            if (!dragged) return;
            dragged = false;
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);
    }

    /** Posicao salva de `name`, ou null. So vale depois de `ready`. */
    function saved(name) { return (cache && cache[name]) || null; }

    globalThis.SQDrag = { attach: attach, attachEdge: attachEdge, restore: restore, clamp: clamp, saved: saved, ready: loading, MARGIN: MARGIN };
})();
