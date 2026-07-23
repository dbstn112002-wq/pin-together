import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8' };
const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  try {
    const path = new URL(request.url, `http://${request.headers.host}`).pathname;
    const target = normalize(join(root, path === '/' ? 'index.html' : decodeURIComponent(path)));
    if (!target.startsWith(root)) throw new Error('Forbidden');
    if (!(await stat(target)).isFile()) throw new Error('Not found');
    response.writeHead(200, { 'Content-Type':types[extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); response.end('Not found');
  }
}).listen(port, () => console.log(`핀투게더 실행 중: http://localhost:${port}`));
