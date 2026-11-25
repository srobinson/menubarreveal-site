// The site on your machine, served the way it is served live: npm run serve   (http://127.0.0.1:8080; a port may follow)
// The folder is the repo root minus the dev files in .assetsignore, with the headers in _headers, the redirects in
// _redirects, and 404.html for a missing path. One directive is left out of the policy, upgrade-insecure-requests:
// this server is plain http, and Safari obeys it even on 127.0.0.1, which would turn every file request into https.
// The home page goes through worker.mjs, the script that answers it live, with this folder's files as its ASSETS.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import worker from '../worker.mjs';
import { headerRules, headersFor, isDevFile, root } from './site.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2' };
const hidden = (path) => isDevFile(path) || ['_headers', '_redirects'].includes(path); // Cloudflare reads those two; it does not serve them
const redirects = readFileSync(join(root, '_redirects'), 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#')).map((line) => line.trim().split(/\s+/)); // from, to, status
const rules = headerRules();

// One path's answer from the files, as Cloudflare's asset server gives it.
const asset = (path) => {
  let file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  let status = 200;
  if (!file.startsWith(root) || hidden(path.slice(1)) || !existsSync(file) || !statSync(file).isFile()) { status = 404; file = join(root, '404.html'); }
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate' };
  for (const [name, value] of headersFor(rules, path)) headers[name] = value.replace(/;\s*upgrade-insecure-requests/, '');
  return { status, headers, body: readFileSync(file) };
};
const ASSETS = { fetch: async (request) => { const { body, ...init } = asset(decodeURIComponent(new URL(request.url).pathname)); return new Response(body, init); } };

const server = createServer(async (req, res) => {
  const { pathname, search } = new URL(req.url, 'http://x');
  const path = decodeURIComponent(pathname);
  const moved = redirects.find(([from]) => from === path);
  if (moved) return res.writeHead(+moved[2], { Location: moved[1] + search }).end(); // the query is kept, as it is live
  if (path !== '/') { const { status, headers, body } = asset(path); return res.writeHead(status, headers).end(body); }
  const answer = await worker.fetch(new Request(new URL(req.url, 'http://x'), { method: req.method, headers: req.headers }), { ASSETS });
  res.writeHead(answer.status, Object.fromEntries(answer.headers)).end(Buffer.from(await answer.arrayBuffer()));
});
server.listen(+(process.argv[2] ?? 8080), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
