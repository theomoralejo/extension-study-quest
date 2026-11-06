/**
 * zoho-api.js — cliente da API do Zoho CRM com a sessao da propria aba.
 *
 * Fonte unica para o historico de campo e o painel de notas: cookie de CSRF,
 * org da URL e a versao da API (descoberta uma vez, de v8 para tras).
 *
 * Expoe `globalThis.SQZoho = { get, post }`.
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
     * POST so na versao ja descoberta por um GET. Tentar varias versoes num
     * POST poderia gravar duas vezes, se uma aceitar e responder erro.
     */
    async function post(path, body) {
        var v = apiVersion || VERSIONS[0];
        var res = await fetch("/crm/" + v + path, {
            method: "POST", headers: headers(true), credentials: "include", body: JSON.stringify(body)
        });
        var json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        if (!res.ok) {
            var d = json && json.data && json.data[0];
            var msg = (d && d.message) || (json && json.message) || ("HTTP " + res.status);
            throw new Error("Zoho recusou a gravacao: " + msg);
        }
        return json || {};
    }

    globalThis.SQZoho = { get: get, post: post };
})();
