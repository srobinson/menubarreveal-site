// Serves this repo's site as it deploys, for checks: node measurements/serve.mjs [port] [folder]
// (no port or 0: a free one, printed; folder: another built site, such as the launch kit's output, instead of this repo)
// The folder is the repo root minus the dev files named in .assetsignore. Headers come from _headers, redirects from
// _redirects. As the publish
// step does, style-src gains the sha256 of each <style> block in index.html (comments skipped, the block's exact text).
// Like the live host: Brotli for text, an ETag with public, max-age=0, must-revalidate unless _headers says otherwise,
// and 404.html for a missing path.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';

const root = process.argv[3] ? resolve(process.argv[3]) + sep : fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2' };
const TEXT = new Set(['.html', '.css', '.md', '.txt', '.xml', '.svg']);
const ignored = existsSync(join(root, '.assetsignore')) ? readFileSync(join(root, '.assetsignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];

// read on every request, so the hash always fits the page as it is now
const styleSrc = () => {
  const page = readFileSync(join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  return ["style-src 'self'", ...[...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`)].join(' ');
};
// _headers: a path pattern on its own line, then its indented "Name: value" lines
const rules = [];
for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
  else rules.at(-1).headers.push(line.trim().split(/:\s*/, 2).length === 2 ? [line.trim().slice(0, line.trim().indexOf(':')), line.trim().slice(line.trim().indexOf(':') + 1).trim()] : null);
}
const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
const policy = rules.flatMap((r) => r.headers).find(([name]) => name === 'Content-Security-Policy')[1];
// upgrade-insecure-requests is left out here: this server is plain http, and WebKit obeys the directive even on
// 127.0.0.1, turning every file request into https, which fails. On the https site it changes nothing.
const csp = () => policy.replace("style-src 'self'", styleSrc()).replace(/;\s*upgrade-insecure-requests/, '');

const packed = new Map();
// _redirects: "from to status" on a line
const redirects = existsSync(join(root, '_redirects')) ? readFileSync(join(root, '_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/)) : [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const moved = redirects.find(([from]) => from === path);
  if (moved) { res.writeHead(+moved[2], { Location: moved[1] }).end(); console.log(moved[2], path); return; }
  let file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  let status = 200;
  const top = path.split('/')[1];
  if (!file.startsWith(root) || file.includes(sep + '..') || ignored.includes(top) || !existsSync(file) || !statSync(file).isFile()) { status = 404; file = join(root, '404.html'); }
  const ext = extname(file);
  let body = readFileSync(file);
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"` };
  for (const rule of rules) if (matches(rule.pattern, path)) for (const [name, value] of rule.headers) headers[name] = name === 'Content-Security-Policy' ? csp() : value;
  if (status === 200 && req.headers['if-none-match'] === headers.ETag) { res.writeHead(304, headers).end(); console.log(304, path); return; }
  if (TEXT.has(ext) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
    if (!packed.has(headers.ETag)) packed.set(headers.ETag, brotliCompressSync(body)); // compressed once, so the work is not counted as server time
    body = packed.get(headers.ETag); headers['Content-Encoding'] = 'br';
  }
  res.writeHead(status, headers).end(body);
  console.log(status, path);
});
server.listen(+(process.argv[2] ?? 0), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/  pid ${process.pid}\n${csp()}`));
