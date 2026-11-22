/**
 * sessao.js — sessao da pessoa na extensao (login da Master Table).
 *
 * Fluxo (contrato descrito no README, secao "Login"):
 *   1. popup → Master Table `auth-with-password` {identity, password} → token PB
 *   2. popup → API das respostas `POST /auth/session` {pbToken} → token da extensao
 *   3. guarda SO `{token, name, email, expiresAt}` em storage.local, chave `sqSessao`
 * A senha e o token PB nunca sao gravados: vivem so dentro de `entrar()`.
 *
 * Toda chamada a API das respostas passa por `api()`: poe o Bearer e, no 401,
 * apaga a sessao e rejeita com `err.semSessao = true` (quem chamou mostra o login).
 *
 * Expoe `globalThis.SQSessao`. Depende de SQBrowser (browser-api.js) e SQConfig (config.js).
 */
(function () {
    'use strict';

    var SQ = globalThis.SQBrowser;
    var CFG = globalThis.SQConfig;
    var CHAVE = 'sqSessao';
    var TEMPO_LIMITE_MS = 15000;

    var MSG_SEM_SESSAO = 'Entre na extensão com o e-mail e a senha da Master Table.';
    var MSG_SESSAO_ENCERRADA = 'Sua sessão expirou ou foi encerrada. Entre de novo com o e-mail e a senha da Master Table.';

    function erro(mensagem, extra) {
        var e = new Error(mensagem);
        if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
        return e;
    }

    function semSessao(mensagem) {
        return erro(mensagem || MSG_SEM_SESSAO, { semSessao: true, status: 401 });
    }

    /** So o que o contrato define. Qualquer outro campo (token PB, senha) fica de fora. */
    function limpa(s) {
        return { token: s.token, name: s.name || '', email: s.email || '', expiresAt: s.expiresAt || null };
    }

    /** Sessao utilizavel ou null: sem token, ou `expiresAt` no passado, = sem sessao. */
    function valida(s) {
        if (!s || typeof s !== 'object' || typeof s.token !== 'string' || !s.token) return null;
        if (s.expiresAt) {
            var t = Date.parse(s.expiresAt);
            if (isFinite(t) && t <= Date.now()) return null;
        }
        return s;
    }

    function ler() {
        return SQ.storageGet([CHAVE]).then(function (r) {
            var bruta = r && r[CHAVE];
            var s = valida(bruta);
            // vencida fica guardada a toa: limpa para os outros contextos verem "sem sessao"
            if (!s && bruta) return apagar().then(function () { return null; });
            return s;
        });
    }

    function gravar(s) {
        var item = {};
        item[CHAVE] = limpa(s);
        return SQ.storageSet(item).then(function () { return item[CHAVE]; });
    }

    function apagar() {
        return SQ.storageRemove([CHAVE]);
    }

    /** fetch com tempo limite explicito: servidor pendurado vira erro de rede, nao spinner eterno. */
    function pedir(url, init) {
        if (typeof AbortController !== 'function') return fetch(url, init);
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, TEMPO_LIMITE_MS);
        init = Object.assign({}, init, { signal: ctrl.signal });
        return fetch(url, init).then(
            function (res) { clearTimeout(timer); return res; },
            function (e) {
                clearTimeout(timer);
                if (e && e.name === 'AbortError') e = erro('tempo esgotado após ' + (TEMPO_LIMITE_MS / 1000) + ' s');
                throw e;
            }
        );
    }

    /**
     * Chamada a API das respostas com a sessao. `path` relativo a API_BASE.
     * `opts.body` (objeto) vira JSON. Resolve o Response (quem chama le o corpo).
     */
    function api(path, opts) {
        opts = opts || {};
        return ler().then(function (s) {
            if (!s) throw semSessao();
            var headers = { Authorization: 'Bearer ' + s.token };
            var init = { method: opts.method || 'GET', headers: headers };
            if (opts.body !== undefined) {
                headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(opts.body);
            }
            return pedir(CFG.url(path), init);
        }).then(function (res) {
            if (res.status !== 401) return res;
            return apagar().then(function () { throw semSessao(MSG_SESSAO_ENCERRADA); });
        });
    }

    function lerCorpo(res) {
        return res.text().then(function (txt) {
            try { return txt ? JSON.parse(txt) : null; } catch (e) { return null; }
        }, function () { return null; });
    }

    function detalhe(data, res) {
        return (data && (data.error || data.message)) || ('HTTP ' + res.status);
    }

    function erroRede(e, onde, base) {
        return erro('Não foi possível entrar: sem conexão com ' + onde + ' (' + ((e && e.message) || 'falha de rede') +
            '). Confira a internet; se persistir, veja se ' + base +
            ' responde sem redirecionar (redirect quebra o CORS da extensão).', { codigo: 'rede' });
    }

    /** Passo 1: Master Table. Resolve o token PB; rejeita com a mensagem para a pessoa. */
    function autenticarMasterTable(identity, password) {
        var base = CFG.MASTER_TABLE_URL;
        return pedir(base + '/api/collections/users/auth-with-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identity: identity, password: password })
        }).catch(function (e) { throw erroRede(e, 'a Master Table', base); })
            .then(function (res) {
                return lerCorpo(res).then(function (data) {
                    if (res.ok && data && data.token) return data.token;
                    if (res.status === 400) {
                        throw erro('E-mail ou senha incorretos. Use o mesmo login da Master Table.', { codigo: 'senha' });
                    }
                    if (res.status === 401 && data && data.mfaId) {
                        throw erro('Sua conta da Master Table usa verificação em duas etapas, e a extensão ainda não aceita esse tipo de login. Peça ao TI da Study Quest uma conta sem verificação em duas etapas para usar a extensão.', { codigo: 'mfa' });
                    }
                    if (res.status === 429) {
                        throw erro('Muitas tentativas de login seguidas: a Master Table bloqueou por um momento. Espere um minuto e tente de novo.', { codigo: 'limite' });
                    }
                    if (res.status >= 500) {
                        throw erro('A Master Table está fora do ar agora (' + detalhe(data, res) + '). Tente de novo em alguns minutos.', { codigo: 'servidor' });
                    }
                    if (res.ok) {
                        throw erro('A Master Table respondeu sem o token do login. Tente de novo; se continuar, avise o TI.', { codigo: 'servidor' });
                    }
                    throw erro('A Master Table recusou o login (' + detalhe(data, res) + '). Confira o e-mail e a senha; se continuar, avise o TI.', { codigo: 'recusado' });
                });
            });
    }

    /** Passo 2: troca o token PB pelo token da extensao. O token PB morre aqui. */
    function abrirSessao(pbToken) {
        return pedir(CFG.url('/auth/session'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pbToken: pbToken })
        }).catch(function (e) { throw erroRede(e, 'o servidor das respostas', CFG.API_BASE); })
            .then(function (res) {
                return lerCorpo(res).then(function (data) {
                    if (res.ok && data && data.token) return data;
                    if (res.status === 403) {
                        throw erro('Sua conta da Master Table não tem acesso à extensão. ' + detalhe(data, res), { codigo: 'acesso' });
                    }
                    if (res.status === 401) {
                        throw erro('A Master Table não confirmou o seu login. Tente entrar de novo.', { codigo: 'recusado' });
                    }
                    if (res.status === 502 || res.status === 503) {
                        throw erro('O servidor das respostas não conseguiu confirmar o login com a Master Table agora (' + detalhe(data, res) + '). Tente de novo em alguns minutos.', { codigo: 'servidor' });
                    }
                    throw erro('O servidor das respostas recusou o login (' + detalhe(data, res) + '). Tente de novo; se continuar, avise o TI.', { codigo: 'servidor' });
                });
            });
    }

    /** Login completo. Resolve a sessao gravada `{token, name, email, expiresAt}`. */
    function entrar(identity, password) {
        identity = String(identity || '').trim();
        if (!identity || !password) {
            return Promise.reject(erro('Preencha o e-mail e a senha da Master Table.', { codigo: 'vazio' }));
        }
        return autenticarMasterTable(identity, password).then(abrirSessao).then(gravar);
    }

    /** Encerra no servidor (falha ignorada) e apaga a sessao local. */
    function sair() {
        return ler().then(function (s) {
            if (!s) return;
            return pedir(CFG.url('/auth/session'), {
                method: 'DELETE',
                headers: { Authorization: 'Bearer ' + s.token }
            }).catch(function () { /* sem rede: a sessao local sai do mesmo jeito */ });
        }).catch(function () { }).then(apagar);
    }

    /** `handler(sessaoOuNull)` quando `sqSessao` muda em qualquer contexto da extensao. */
    function onMudar(handler) {
        SQ.onStorageChange(function (changes, area) {
            if (area && area !== 'local') return;
            if (!Object.prototype.hasOwnProperty.call(changes, CHAVE)) return;
            handler(valida(changes[CHAVE].newValue));
        });
    }

    globalThis.SQSessao = {
        CHAVE: CHAVE,
        MSG_SEM_SESSAO: MSG_SEM_SESSAO,
        ler: ler,
        gravar: gravar,
        apagar: apagar,
        api: api,
        entrar: entrar,
        sair: sair,
        onMudar: onMudar
    };
})();
