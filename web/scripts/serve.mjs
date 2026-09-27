import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/preview/')) { response.writeHead(404); response.end(); return; }
    let path = resolve(root, pathname.slice('/preview/'.length) || 'index.html');
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.PORT ?? 5180), '0.0.0.0', () => console.log('Static export at http://localhost:5180/preview/'));
