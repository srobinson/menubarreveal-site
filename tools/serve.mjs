// The site on your machine, served the way it is served live: npm run serve   (http://127.0.0.1:8080; a port may follow)
// The folder is the repo root minus the dev files in .assetsignore, with the headers in _headers, the redirects in
// _redirects, and 404.html for a missing path. One directive is left out of the policy, upgrade-insecure-requests:
// this server is plain http, and Safari obeys it even on 127.0.0.1, which would turn every file request into https.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2' };
const lines = (file) => readFileSync(join(root, file), 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#'));
const ignored = [...lines('.assetsignore').map((line) => line.trim()), '_headers', '_redirects'];
const redirects = lines('_redirects').map((line) => line.trim().split(/\s+/)); // from, to, status
// _headers: a path pattern on its own line, then its indented "Name: value" lines
const rules = [];
for (const line of lines('_headers')) {
  if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
  else rules.at(-1).headers.push([line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim().replace(/;\s*upgrade-insecure-requests/, '')]);
}
const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const moved = redirects.find(([from]) => from === path);
  if (moved) return res.writeHead(+moved[2], { Location: moved[1] }).end();
  let file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  let status = 200;
  if (!file.startsWith(root) || ignored.includes(path.split('/')[1]) || !existsSync(file) || !statSync(file).isFile()) { status = 404; file = join(root, '404.html'); }
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate' };
  for (const rule of rules) if (matches(rule.pattern, path)) for (const [name, value] of rule.headers) headers[name] = value;
  res.writeHead(status, headers).end(readFileSync(file));
});
server.listen(+(process.argv[2] ?? 8080), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
