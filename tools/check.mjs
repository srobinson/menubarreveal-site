// One fact, one place: facts.json. The site says each fact in several files, by hand; this checks that every copy
// agrees with facts.json, that every file the pages name exists, that each picture is named for its bytes, and that
// the pages carry nothing the Content Security Policy would refuse. It verifies and writes nothing: to change a
// fact, change facts.json and each place this names.   node tools/check.mjs   (part of npm run lint)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PAGES, forbiddenInline, styleSrc, styleSrcInHeaders } from './csp.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const facts = JSON.parse(read('facts.json'));
const fails = [];
const same = (where, found, want) => { if (found !== want) fails.push(`${where}\n    says:       ${JSON.stringify(found)}\n    facts.json: ${JSON.stringify(want)}`); };
const holds = (where, text, want) => { if (!text.includes(want)) fails.push(`${where}\n    lacks:      ${JSON.stringify(want)}`); };
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---------- index.html: the head ----------
const page = read('index.html');
const head = page.slice(0, page.indexOf('</head>'));
const once = (where, found, want) => (found.length === 1 ? same(where, found[0], want) : fails.push(`${where}: expected once, found ${found.length} times`));
const meta = (name) => [...head.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"/g)].filter((m) => m[1] === name).map((m) => unescape(m[2]));
once('index.html <title>', [...head.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => unescape(m[1])), facts.title);
once('index.html canonical link', [...head.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]), facts.url);
for (const [name, want] of Object.entries({
  description: facts.summary, 'og:description': facts.summary, 'twitter:description': facts.summary,
  'og:title': facts.title, 'twitter:title': facts.title, 'og:site_name': facts.name, 'og:url': facts.url,
  'og:image': facts.url + 'og.jpg', 'twitter:image': facts.url + 'og.jpg',
  'og:image:alt': facts.shareImageAlt, 'twitter:image:alt': facts.shareImageAlt, 'theme-color': facts.themeColor,
})) once(`index.html meta ${name}`, meta(name), want);

// ---------- index.html: the JSON-LD blocks and the page itself ----------
const nodes = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m, i) => {
  try { return JSON.parse(m[1]); } catch (e) { fails.push(`index.html JSON-LD block ${i + 1} is not JSON: ${e.message}`); return {}; }
});
const node = (type) => { const found = nodes.filter((n) => n['@type'] === type); if (found.length !== 1) fails.push(`index.html: expected one ${type} JSON-LD block, found ${found.length}`); return found[0] ?? {}; };
const app = node('SoftwareApplication');
const site = node('WebSite');
same('JSON-LD SoftwareApplication name', app.name, facts.name);
same('JSON-LD SoftwareApplication url', app.url, facts.url);
same('JSON-LD SoftwareApplication description', app.description, facts.summary);
same('JSON-LD SoftwareApplication sameAs', app.sameAs, facts.repo);
same('JSON-LD WebSite name', site.name, facts.name);
same('JSON-LD WebSite url', site.url, facts.url);
once('index.html: the link on the page', [...page.matchAll(/<a class="get" href="([^"]*)"/g)].map((m) => m[1]), facts.repo);
holds('index.html styles: the page background (html)', page, `html {\n  background: ${facts.themeColor};`);

// ---------- the files beside it ----------
const md = read('index.md');
same('index.md heading', md.split('\n')[0], `# ${facts.name}`);
holds('index.md tagline', md, `\n> ${facts.tagline}\n`);
holds('index.md download link', md, `(${facts.downloadUrl})`);
holds('index.md version', md, `version ${facts.version} `);
holds('index.md release notes link', md, `(${facts.repo}/releases/tag/v${facts.version})`);
holds('index.md minimum macOS', md, `macOS ${facts.minMacOS} or later`);
holds('index.md source link', md, `(${facts.repo})`);
holds('index.md web page link', md, `(${facts.url})`);
const llms = read('llms.txt');
same('llms.txt heading', llms.split('\n')[0], `# ${facts.name}`);
holds('llms.txt summary', llms, `\n> ${facts.summary}\n`);
holds('llms.txt web page link', llms, `(${facts.url})`);
holds('llms.txt product facts link', llms, `(${facts.url}index.md)`);
once('sitemap.xml loc', [...read('sitemap.xml').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]), facts.url);
once('robots.txt Sitemap', [...read('robots.txt').matchAll(/^Sitemap:\s*(\S+)\s*$/gm)].map((m) => m[1]), facts.url + 'sitemap.xml');
const notFound = read('404.html');
holds('404.html <title>', notFound.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '', facts.name);
holds('404.html theme-color', notFound, `<meta name="theme-color" content="${facts.themeColor}">`);

// ---------- every file the pages name is here ----------
const names = (text) => [
  ...[...text.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
  ...[...text.matchAll(/\simagesrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((part) => part.trim().split(/\s+/)[0])),
  ...[...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
].filter((ref) => !/^(#|%23|data:|https?:)/.test(ref)); // not a fragment (plain or escaped inside a data URL), not inline, not another site
for (const file of [...PAGES, 'assets/404/404.css']) {
  for (const ref of new Set(names(read(file).replace(/<!--[\s\S]*?-->/g, '')))) {
    const path = ref.startsWith('/') ? ref.slice(1) : new URL(ref, new URL(file, 'http://x/')).pathname.slice(1);
    if (!existsSync(new URL(path === '' ? 'index.html' : path, root))) fails.push(`${file} names ${ref}, which is not in the repo`);
  }
}

// ---------- a picture's name carries the digest of its bytes (npm run art names them) ----------
for (const file of readdirSync(new URL('assets/art/', root))) {
  const digest = createHash('sha256').update(readFileSync(new URL(`assets/art/${file}`, root))).digest('hex').slice(0, 16);
  if (!file.includes(`.${digest}.`)) fails.push(`assets/art/${file}: its name should carry the digest of its bytes, ${digest}: run npm run art`);
}

// ---------- the Content Security Policy ----------
if (styleSrcInHeaders() !== styleSrc()) fails.push(`_headers has a stale style hash: run npm run csp, then commit _headers\n    says:       ${styleSrcInHeaders()}\n    the pages:  ${styleSrc()}`);
for (const file of PAGES) for (const use of new Set(forbiddenInline(read(file)))) fails.push(`${file} carries ${use}: the policy allows no style attribute, event handler or inline script`);

if (fails.length) { console.error(`check: ${fails.length} disagree\n\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log('check: every copy of the facts agrees with facts.json, every file named is here, and the style hash is current');
