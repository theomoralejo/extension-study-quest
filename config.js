/**
 * config.js — fonte unica de configuracao do cliente.
 *
 * ATENCAO sobre a chave: tudo que a extensao carrega e legivel por qualquer
 * pessoa que instale ou desempacote o .zip/.crx. A chave abaixo NAO e um
 * segredo — ela existe apenas para barrar trafego anonimo casual na API.
 * Nao trate como controle de acesso e nao reaproveite esse valor em nenhum
 * outro sistema. Autenticacao real precisa ser por usuario, no servidor.
 */
(function () {
    'use strict';

    // Precisa ser o dominio FINAL, nunca um que redirecione.
    //
    // `cv.studyquestuk.com` responde 301 para `cv.attriostudio.com`. Como as
    // chamadas mandam o header `x-api-key`, elas deixam de ser "simple
    // requests" e o browser faz um preflight OPTIONS antes — e a spec do Fetch
    // trata redirect NA RESPOSTA DE PREFLIGHT como erro fatal: o browser nao
    // segue, aborta, e o content script recebe apenas "Failed to fetch".
    // Por isso o `curl` funciona (segue o 301 alegremente) e a extensao nao.
    var API_BASE = 'https://cv.attriostudio.com/api';
    var API_KEY = 'sq-54321-secret-key';

    globalThis.SQConfig = {
        API_BASE: API_BASE,

        /** Monta a URL de um endpoint da API. */
        url: function (path) {
            return API_BASE + path;
        },

        /** Headers padrao das chamadas. `json` inclui Content-Type. */
        headers: function (json) {
            var h = { 'x-api-key': API_KEY };
            if (json) h['Content-Type'] = 'application/json';
            return h;
        }
    };
})();
