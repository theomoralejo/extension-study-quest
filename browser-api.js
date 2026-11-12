/**
 * browser-api.js — camada de compatibilidade entre navegadores.
 *
 * Chrome e Edge expoem `chrome.*` com callbacks. Firefox e Safari expoem
 * `browser.*` com Promises (e um alias `chrome.*` que nem sempre cobre tudo).
 * Em vez de apostar em qual dos dois modelos o navegador usa, cada wrapper
 * aqui chama a API e decide pelo VALOR DE RETORNO: se veio um thenable, e
 * Promise; se veio undefined, o resultado chega pelo callback.
 *
 * Expoe `globalThis.SQBrowser` com metodos que sempre retornam Promise.
 */
(function () {
    'use strict';

    var rt = globalThis.browser || globalThis.chrome;
    // So um script que nasceu com id de extensao pode ficar orfao; pagina de teste nao tem id.
    var bornWithId = !!(rt && rt.runtime && rt.runtime.id);

    /**
     * Invoca `fn` no modelo que o navegador oferecer e normaliza para Promise.
     * Nunca rejeita por erro de extensao ausente: resolve `fallback` para que
     * o chamador siga funcionando sem a API (ex.: fora do contexto da extensao).
     */
    function normalize(fn, thisArg, args, fallback) {
        return new Promise(function (resolve) {
            if (typeof fn !== 'function') {
                resolve(fallback);
                return;
            }

            var settled = false;
            function settle(value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }

            var maybePromise;
            try {
                // O callback so e consumido no modelo Chrome/Edge. No modelo
                // Promise ele e ignorado pela API e o `then` abaixo resolve.
                maybePromise = fn.apply(thisArg, args.concat(function (result) {
                    // `lastError` precisa ser lido para o navegador nao logar
                    // "Unchecked runtime.lastError" no console do usuario.
                    var err = rt && rt.runtime && rt.runtime.lastError;
                    settle(err ? fallback : result);
                }));
            } catch (e) {
                settle(fallback);
                return;
            }

            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(settle, function () { settle(fallback); });
            }
        });
    }

    var SQBrowser = {
        /** true quando rodando dentro de uma extensao (qualquer navegador). */
        available: !!(rt && rt.runtime),

        /**
         * false quando a extensao foi atualizada ou recarregada com a aba aberta: o script
         * antigo continua na pagina, mas toda chamada a API lanca "Extension context invalidated".
         */
        alive: function () {
            if (!bornWithId) return true;
            try { return !!(rt.runtime && rt.runtime.id); } catch (e) { return false; }
        },

        /** Le chaves do storage local. Resolve {} se indisponivel. */
        storageGet: function (keys) {
            var storage = rt && rt.storage && rt.storage.local;
            if (!storage) return Promise.resolve({});
            return normalize(storage.get, storage, [keys], {});
        },

        /** Grava no storage local. Resolve sempre, mesmo em falha. */
        storageSet: function (items) {
            var storage = rt && rt.storage && rt.storage.local;
            if (!storage) return Promise.resolve();
            return normalize(storage.set, storage, [items], undefined);
        },

        /** Resolve a aba ativa da janela atual, ou null. */
        activeTab: function () {
            var tabs = rt && rt.tabs;
            if (!tabs || !tabs.query) return Promise.resolve(null);
            return normalize(tabs.query, tabs, [{ active: true, currentWindow: true }], [])
                .then(function (result) {
                    return (result && result[0]) || null;
                });
        },

        /** Envia mensagem a um content script. Resolve null se ninguem responder. */
        sendMessageToTab: function (tabId, message) {
            var tabs = rt && rt.tabs;
            if (!tabs || !tabs.sendMessage) return Promise.resolve(null);
            return normalize(tabs.sendMessage, tabs, [tabId, message], null);
        },

        /** URL absoluta de um recurso empacotado na extensao. */
        getURL: function (path) {
            try {
                if (rt && rt.runtime && rt.runtime.getURL) return rt.runtime.getURL(path);
            } catch (e) { /* contexto invalidado: o caminho relativo so nao carrega a imagem */ }
            return path;
        },

        /**
         * Registra listener de mensagens.
         * `handler(request)` pode devolver valor direto ou Promise; os dois
         * modelos de resposta (callback do Chrome, Promise do Firefox) sao
         * atendidos, entao o mesmo handler serve nos quatro navegadores.
         */
        onMessage: function (handler) {
            if (!rt || !rt.runtime || !rt.runtime.onMessage) return;
            rt.runtime.onMessage.addListener(function (request, sender, sendResponse) {
                var result;
                try {
                    result = handler(request);
                } catch (e) {
                    result = undefined;
                }

                if (result && typeof result.then === 'function') {
                    result.then(sendResponse, function () { sendResponse(undefined); });
                    return true; // mantem o canal aberto (Chrome/Edge)
                }

                sendResponse(result);
                return false;
            });
        }
    };

    globalThis.SQBrowser = SQBrowser;
})();
