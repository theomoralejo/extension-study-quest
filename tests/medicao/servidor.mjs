/**
 * Servidor minimo para a medicao de custo do field-history.
 *
 * Existe por UM motivo: `onUrl()` do field-history.js so ativa o modulo quando
 * `location.pathname` casa `/tab/(Potentials|Deals|Leads)/(\d+)`. Em `file://`
 * nao da para falsificar o pathname, entao a pagina tem que ser servida sob um
 * caminho de verdade. Qualquer caminho devolve a mesma pagina.
 *
 * Tudo sob /crm/ responde 403, de proposito: assim a API do Zoho "recusa" e o
 * modulo cai na raspagem da Timeline, que e o caminho mais caro — o que o
 * navegador do Theo faz de fato, porque a pagina real tambem nao serve essas
 * rotas para a extensao em teste.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const PORTA = Number(process.argv[2] || 8731);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/crm/v')) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('negado de proposito');
    return;
  }

  if (url.pathname.endsWith('field-history.js')) {
    const js = await readFile(path.join(AQUI, '..', '..', 'field-history.js'));
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(js);
    return;
  }

  // `?p=laco` escolhe a pagina; o caminho continua sendo o do registro do Zoho,
  // porque e dele que o field-history depende para se ativar.
  const pagina = url.searchParams.get('p') === 'laco' ? 'medir-laco.html' : 'medir-tick.html';
  const html = await readFile(path.join(AQUI, pagina));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORTA, () => {
  console.log(`medicao em http://localhost:${PORTA}/crm/org1/tab/Deals/1234567`);
});
