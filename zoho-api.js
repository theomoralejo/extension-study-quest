/**
 * zoho-api.js — cliente da API do Zoho CRM com a sessao da propria aba.
 *
 * Fonte unica para o historico de campo e o painel de notas: cookie de CSRF,
 * org da URL e a versao da API (descoberta uma vez, de v8 para tras).
 *
 * Expoe `globalThis.SQZoho = { get, post, put, del, recordFromUrl, module }`.
 */
(function () {
    'use strict';

    var VERSIONS = ["v8", "v7", "v6", "v5", "v2.2", "v2"];
    var apiVersion = null;

    function headers(json) {
        var c = function (n) { return (document.cookie.match(new RegExp("(?:^|;\\s*)" + n + "=([^;]+)")) || [])[1]; };
        var csrf = c("CSRF_TOKEN") || c("crmcsrfparam");
        var org = (location.pathname.match(/\/crm\/org(\d+)\//) || [])[1];
        var h = { "X-Requested-With": "XMLHttpRequest" };
        if (csrf) h["X-ZCSRF-TOKEN"] = "crmcsrfparam=" + decodeURIComponent(csrf);
        if (org) h["X-CRM-ORG"] = org;
        if (json) h["Content-Type"] = "application/json";
        return h;
    }

    /** GET com descoberta de versao: tenta da mais nova para a mais velha. */
    async function get(path) {
        var versions = apiVersion ? [apiVersion] : VERSIONS;
        var tried = [];
        for (var i = 0; i < versions.length; i++) {
            var v = versions[i];
            var res = await fetch("/crm/" + v + path, { headers: headers(false), credentials: "include" });
            if (res.status === 204) { apiVersion = v; return {}; }
            if (res.ok) { apiVersion = v; return res.json(); }
            tried.push(v + ": " + res.status);
        }
        throw new Error("Zoho recusou a chamada (" + tried.join(", ") + ")");
    }

    /**
     * Gravacao (POST/PUT/DELETE) so na versao ja descoberta por um GET. Tentar
     * varias versoes poderia gravar duas vezes, se uma aceitar e responder erro.
     */
    async function write(method, path, body) {
        var v = apiVersion || VERSIONS[0];
        var opts = { method: method, headers: headers(body !== undefined), credentials: "include" };
        if (body !== undefined) opts.body = JSON.stringify(body);
        var res = await fetch("/crm/" + v + path, opts);
        var json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        if (!res.ok) {
            var d = json && json.data && json.data[0];
            var msg = (d && d.message) || (json && json.message) || ("HTTP " + res.status);
            throw new Error("Zoho recusou a gravacao: " + msg);
        }
        var d0 = json && json.data && json.data[0];
        if (d0 && d0.code && d0.code !== "SUCCESS") throw new Error("Zoho recusou a gravacao: " + (d0.message || d0.code));
        return json || {};
    }
    function post(path, body) { return write("POST", path, body); }
    function put(path, body) { return write("PUT", path, body); }
    function del(path) { return write("DELETE", path); }

    /** Registro aberto na aba: { tab, id } ou null fora de pagina de registro. */
    function recordFromUrl() {
        var m = location.pathname.match(/\/tab\/([A-Za-z0-9_]+)\/(\d+)\/?$/);
        return m ? { tab: m[1], id: m[2] } : null;
    }

    // Nome na URL (Potentials, CustomModule3...) -> { api, label } do modulo.
    var modules = null;
    async function module(tab) {
        if (!modules) {
            var map = { Potentials: { api: "Deals", label: "Deal" } };
            try {
                var body = await get("/settings/modules");
                (body.modules || []).forEach(function (m) {
                    if (!m.api_name) return;
                    var info = { api: m.api_name, label: m.singular_label || m.api_name };
                    map[m.api_name] = info;
                    if (m.module_name) map[m.module_name] = info;
                });
                modules = map;
            } catch (e) {
                return map[tab] || { api: tab, label: tab }; // sem mapa nao fica em cache: tenta de novo depois
            }
        }
        return modules[tab] || { api: tab, label: tab };
    }

    globalThis.SQZoho = { get: get, post: post, put: put, del: del, recordFromUrl: recordFromUrl, module: module };
})();
