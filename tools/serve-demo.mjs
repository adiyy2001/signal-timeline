import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';

const root = join(fileURLToPath(import.meta.url), '..', '..');

export const defaultDirectory = join(root, 'dist', 'demo', 'browser');
export const defaultBase = '/signal-timeline/';

export function serveDemo({ directory = defaultDirectory, base = defaultBase, port = 0 } = {}) {
  const assets = sirv(directory, { single: true, etag: true });
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url === '/' || url === base.slice(0, -1)) {
      response.writeHead(302, { location: base });
      response.end();
      return;
    }
    if (!url.startsWith(base)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    request.url = `/${url.slice(base.length)}`;
    assets(request, response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${bound}${base}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4300);
  const { url } = await serveDemo({ port });
  console.log(`serving ${url}`);
}
