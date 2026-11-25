// The Content Security Policy and the pages it guards.
//   node tools/csp.mjs            check: exit 1 if _headers' style-src does not carry the pages' style hashes
//   node tools/csp.mjs --write    write them into _headers (npm run csp)
// The policy has no 'unsafe-inline'. A <style> block is allowed by the sha256 of its exact text, so the hash in
// _headers must change whenever the block does; `npm run lint` fails until it has. A style attribute, an event handler
// attribute or an inline script cannot be allowed by a hash and must not appear (JSON-LD is data, not script).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
export const PAGES = ['index.html', '404.html'];
// HTML comments hide markup from the browser, so they are skipped.
const visible = (doc) => doc.replace(/<!--[\s\S]*?-->/g, '');

export const forbiddenInline = (doc) => [...visible(doc).matchAll(/\sstyle\s*=|\son[a-z]+\s*=|<script\b(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>/gi)].map((m) => m[0].trim());
const styleHashes = (doc) => [...visible(doc).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
// 'self' (the 404 page's style sheet is a file) plus every distinct block hash, in page order
export const styleSrc = () => ["style-src 'self'", ...new Set(PAGES.flatMap((page) => styleHashes(read(page))))].join(' ');
// the style-src directive on the Content-Security-Policy line (a comment in _headers may say the words too)
const STYLE_SRC = /(?<=^\s*Content-Security-Policy:.*)style-src[^;\n]*/m;
export const styleSrcInHeaders = () => read('_headers').match(STYLE_SRC)?.[0];

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const want = styleSrc();
  if (styleSrcInHeaders() === want) console.log(`_headers: ${want}`);
  else if (process.argv.includes('--write')) { writeFileSync(new URL('_headers', root), read('_headers').replace(STYLE_SRC, want)); console.log(`_headers updated: ${want}`); }
  else { console.error(`_headers has a stale style hash: run npm run csp\n  is:     ${styleSrcInHeaders()}\n  wanted: ${want}`); process.exit(1); }
}
