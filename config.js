/**
 * config.js — fonte unica de configuracao do cliente.
 *
 * Nao ha chave nem segredo aqui: tudo que a extensao carrega e legivel por quem
 * a instala. O acesso e por pessoa: login da Master Table, trocado no servidor
 * por um token proprio da extensao (ver sessao.js).
 */
(function () {
    'use strict';

    // Precisa ser o dominio FINAL, nunca um que redirecione.
    //
    // As chamadas mandam o header `Authorization`, entao deixam de ser "simple
    // requests" e o browser faz um preflight OPTIONS antes — e a spec do Fetch
    // trata redirect NA RESPOSTA DE PREFLIGHT como erro fatal: o browser nao
    // segue, aborta, e o content script recebe apenas "Failed to fetch".
    // Por isso o `curl` funciona (segue o redirect) e a extensao nao.
    var API_BASE = 'https://cv.attriostudio.com/api';

    // Master Table (PocketBase): so o popup fala com ela, e so para o login.
    var MASTER_TABLE_URL = 'https://api.master.studyquestuk.com';

    globalThis.SQConfig = {
        API_BASE: API_BASE,
        MASTER_TABLE_URL: MASTER_TABLE_URL,

        /** Monta a URL de um endpoint da API das respostas. */
        url: function (path) {
            return API_BASE + path;
        }
    };
})();
