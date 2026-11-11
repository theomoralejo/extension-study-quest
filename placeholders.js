/**
 * placeholders.js — campos do registro dentro das respostas rapidas.
 *
 * No texto da resposta, `#Nome_API` (ex.: #Deal_Name, #Stage, #Owner) vira o
 * valor daquele campo no registro aberto, na hora de inserir. Token que nao e
 * campo do modulo fica como esta: hashtag comum no texto nao some. Fora de
 * pagina de registro, nada e trocado.
 *
 * Registro: GET /{modulo}/{id} (v8; `fields` so e obrigatorio na listagem).
 * Expoe `globalThis.SQPlaceholders = { fields, fill, format, TOKEN }`.
 */
(function () {
    'use strict';

    var TOKEN = /#([A-Za-z][A-Za-z0-9_]*)/g;
    var TTL = 15000; // titulo e texto do mesmo template: uma leitura so
    var SKIP_TYPES = { subform: 1, fileupload: 1, imageupload: 1, profileimage: 1 };
    var recordCache = { key: null, at: 0, promise: null };
    var metaCache = {};

    function api() { return globalThis.SQZoho; }

    async function currentRecord() {
        var rec = api().recordFromUrl();
        if (!rec) return null;
        var mod = await api().module(rec.tab);
        var key = mod.api + '/' + rec.id;
        if (recordCache.key !== key || Date.now() - recordCache.at > TTL) {
            recordCache = {
                key: key, at: Date.now(),
                promise: api().get('/' + mod.api + '/' + rec.id).then(function (b) { return (b.data && b.data[0]) || {}; })
            };
            recordCache.promise.catch(function () { recordCache.key = null; });
        }
        return { module: mod, data: await recordCache.promise };
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    /** Valor do Zoho em texto legivel: lookup pelo nome, lista por virgula, data no formato local. */
    function format(v) {
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.map(format).filter(Boolean).join(', ');
        if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
        if (typeof v === 'object') return v.name || v.display_value || v.full_name || v.email || '';
        var s = String(v);
        var d = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (d) return d[3] + '/' + d[2] + '/' + d[1];
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
            var t = new Date(s);
            if (!isNaN(t)) return pad(t.getDate()) + '/' + pad(t.getMonth() + 1) + '/' + t.getFullYear() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
        }
        return s;
    }

    /** Troca os #campos de `text` pelos valores do registro aberto. Em falha, devolve o texto intacto. */
    async function fill(text) {
        text = text || '';
        TOKEN.lastIndex = 0;
        if (!TOKEN.test(text)) return text;
        var rec;
        try { rec = await currentRecord(); } catch (e) { return text; }
        if (!rec) return text;
        return text.replace(TOKEN, function (all, name) {
            return Object.prototype.hasOwnProperty.call(rec.data, name) ? format(rec.data[name]) : all;
        });
    }

    /** Campos do modulo aberto, com o valor deste registro, para o seletor do popup. */
    async function fields() {
        var rec = await currentRecord();
        if (!rec) return null;
        var mod = rec.module.api;
        if (!metaCache[mod]) {
            metaCache[mod] = api().get('/settings/fields?module=' + encodeURIComponent(mod));
            metaCache[mod].catch(function () { delete metaCache[mod]; });
        }
        var meta = await metaCache[mod];
        var list = (meta.fields || []).filter(function (f) {
            return f.api_name && !SKIP_TYPES[f.data_type] && /^[A-Za-z][A-Za-z0-9_]*$/.test(f.api_name);
        }).map(function (f) {
            return { api: f.api_name, label: f.field_label || f.display_label || f.api_name, value: format(rec.data[f.api_name]) };
        });
        list.sort(function (a, b) { return a.label.localeCompare(b.label); });
        return { module: rec.module.label, fields: list };
    }

    globalThis.SQPlaceholders = { fields: fields, fill: fill, format: format, TOKEN: TOKEN };
})();
