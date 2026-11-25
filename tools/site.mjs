// The site as it is served: which files in this folder are the site, and which headers each path gets.
// tools/serve.mjs, tools/deploy.mjs and tools/smoke.mjs all read .assetsignore and _headers through here, so the local
// server, the upload and the check of the served site cannot disagree about either.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const lines = (file) => readFileSync(join(root, file), 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#'));

// .assetsignore: one path per line, from the root. A file, or a folder and everything in it. A pattern is refused
// here, loudly, because a line this did not understand would ship the files it meant to hold back.
const devPaths = lines('.assetsignore').map((line) => line.trim().replace(/^\/+|\/+$/g, ''));
const patterns = devPaths.filter((path) => /[*?![\]\\]/.test(path));
if (patterns.length) throw new Error(`.assetsignore takes plain paths only, no patterns: ${patterns.join(', ')}`);
export const isDevFile = (path) => devPaths.some((dev) => path === dev || path.startsWith(`${dev}/`));
// What a deploy uploads: the tracked files minus the dev files.
export const siteFiles = () => execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((file) => file && !isDevFile(file));

// _headers: a path pattern on its own line, then its indented "Name: value" lines.
export const headerRules = (text = readFileSync(join(root, '_headers'), 'utf8')) => {
  const rules = [];
  for (const line of text.split('\n').filter((l) => l.trim() && !l.startsWith('#'))) {
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
    else rules.at(-1).headers.push([line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]);
  }
  return rules;
};
const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
// The headers a path gets, as [name, value] pairs. Cloudflare joins the values when two rules set one header.
export const headersFor = (rules, path) => {
  const found = new Map();
  for (const rule of rules) if (matches(rule.pattern, path)) for (const [name, value] of rule.headers) {
    const key = name.toLowerCase();
    found.set(key, [name, found.has(key) ? `${found.get(key)[1]}, ${value}` : value]);
  }
  return [...found.values()];
};
// The preview's _headers: one site wide X-Robots-Tag; the per path ones go, so no response joins two values.
export const withNoindex = (text) => {
  const headers = text.replace(/^[ \t]+X-Robots-Tag:.*\n/gim, '').replace(/^\/\*\n/m, '/*\n  X-Robots-Tag: noindex, nofollow\n');
  if (!headers.includes('/*\n  X-Robots-Tag: noindex, nofollow\n')) throw new Error('could not add noindex to the preview headers');
  return headers;
};
