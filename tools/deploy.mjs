// From this folder to the live site. A deploy step, not a build: what is served is the files as they are here,
// copied untouched (the preview copy alone gains a noindex header).
//   npm run deploy                 dry run: every check, then wrangler validates the site and the www Worker; uploads nothing
//   npm run deploy -- --preview    the same checks, then https://preview.menubarreveal.com (noindexed), then a smoke check
//   npm run deploy -- --live       the same checks, then https://menubarreveal.com and the www redirect, then a smoke check
// Order: the style hash in _headers, lint and the facts check, the product facts, a clean git tree, wrangler, smoke check.
// It stops at the first step that fails. Wrangler uses the logged in Cloudflare account (`npx wrangler login`).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { root, siteFiles, withNoindex } from './site.mjs';

const mode = process.argv[2] ?? '--dry-run';
if (!['--dry-run', '--preview', '--live'].includes(mode)) { console.error('usage: npm run deploy [-- --preview | -- --live]'); process.exit(2); }
const HOSTS = { '--preview': 'https://preview.menubarreveal.com', '--live': 'https://menubarreveal.com' };
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const out = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' });
const step = (name, fn) => { console.log(`\ndeploy: == ${name}`); return fn(); };
const stop = (why) => { console.error(`deploy: STOPPED: ${why}. Nothing after this step ran.`); process.exit(1); };
const wrangler = (...args) => run('npx', 'wrangler', 'deploy', ...args);

step('the style hash in _headers (tools/csp.mjs --write)', () => run('node', 'tools/csp.mjs', '--write'));
step('lint and the facts check (npm run lint)', () => run('npm', 'run', '--silent', 'lint'));
step('the product facts against the product repo (tools/product-facts.mjs)', () => run('node', 'tools/product-facts.mjs'));
if (mode !== '--dry-run') step('a clean git tree: what goes up is a commit', () => {
  const dirty = out('git', 'status', '--porcelain').trim();
  if (dirty) stop(`uncommitted changes\n${dirty}`);
  console.log(`commit ${out('git', 'rev-parse', '--short', 'HEAD').trim()}`);
});

// What goes up is a copy of the tracked files minus the dev files in .assetsignore: wrangler is pointed at that copy
// (.deploy/, or .preview/ with noindex), never at the repo root, so node_modules and the tools cannot be uploaded.
const copySite = (to, { noindex = false } = {}) => {
  const files = siteFiles();
  rmSync(join(root, to), { recursive: true, force: true });
  for (const file of files) {
    mkdirSync(dirname(join(root, to, file)), { recursive: true });
    cpSync(join(root, file), join(root, to, file));
  }
  if (noindex) writeFileSync(join(root, to, '_headers'), withNoindex(readFileSync(join(root, to, '_headers'), 'utf8')));
  console.log(`${to}/: ${files.length} files`);
};

if (mode === '--dry-run') {
  const tmp = join(root, '.wrangler', 'dry-run');
  step('the copy that would go up', () => copySite('.deploy'));
  step('wrangler dry run: the site', () => wrangler('--env=', '--dry-run', '--outdir', tmp));
  step('wrangler dry run: the www redirect', () => wrangler('--config', 'www-redirect/wrangler.toml', '--dry-run', '--outdir', tmp));
  rmSync(join(root, '.deploy'), { recursive: true, force: true });
  console.log('\ndeploy: dry run passed. Nothing was uploaded.');
  process.exit(0);
}

if (mode === '--preview') {
  step('the preview copy: the site, plus X-Robots-Tag: noindex, nofollow on every response', () => {
    // refuse unless wrangler.toml's preview environment names the preview Worker and host and nothing else
    const env = readFileSync(join(root, 'wrangler.toml'), 'utf8').split('[env.preview]')[1] ?? '';
    for (const line of ['name = "menubarreveal-preview"', 'routes = [{ pattern = "preview.menubarreveal.com", custom_domain = true }]', 'directory = "./.preview"']) {
      if (!env.includes(line)) stop(`wrangler.toml [env.preview] lacks: ${line}`);
    }
    copySite('.preview', { noindex: true });
  });
  step('wrangler deploy: preview only', () => wrangler('--env', 'preview'));
  rmSync(join(root, '.preview'), { recursive: true, force: true });
} else {
  step('the copy that goes up', () => copySite('.deploy'));
  step('wrangler deploy: the www redirect', () => wrangler('--config', 'www-redirect/wrangler.toml'));
  step('wrangler deploy: the site', () => wrangler('--env='));
  rmSync(join(root, '.deploy'), { recursive: true, force: true });
}

// ---------- smoke check of the served site ----------
const host = HOSTS[mode];
const fails = [];
const check = (name, pass) => { console.log(`  ${pass ? 'pass' : 'FAIL'}  ${name}`); if (!pass) fails.push(name); };
const get = (url, init) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });
await step(`smoke check ${host}`, async () => {
  const page = readFileSync(join(root, 'index.html'), 'utf8');
  let home;
  for (let i = 0; i < 12; i += 1) { // the edge can take a few seconds to serve the new files
    home = await get(`${host}/`).catch(() => null);
    if (home?.status === 200 && (await home.clone().text()) === page) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  check(`${host}/ returns 200`, home?.status === 200);
  check(`${host}/ serves this index.html, byte for byte`, home && (await home.text()) === page);
  const policy = readFileSync(join(root, '_headers'), 'utf8').match(/Content-Security-Policy:\s*(.*)/)[1].trim();
  check('the Content-Security-Policy header is the one in _headers', home?.headers.get('content-security-policy') === policy);
  const robotsTag = home?.headers.get('x-robots-tag') ?? '';
  check('og.jpg returns 200', (await get(`${host}/og.jpg`)).status === 200);
  check('a missing path returns 404', (await get(`${host}/no-such-page`)).status === 404);
  const moved = await get(`${host}/index.html`);
  check('/index.html answers 301 to /', moved.status === 301 && new URL(moved.headers.get('location'), host).pathname === '/');
  if (mode === '--preview') check('every response says noindex', /noindex/i.test(robotsTag));
  else {
    check('the home page does not say noindex', !/noindex/i.test(robotsTag));
    const robots = await (await get(`${host}/robots.txt`)).text();
    check('robots.txt allows all and names the sitemap', /^Allow: \/$/m.test(robots) && !/^Disallow: \/$/m.test(robots) && robots.includes(`Sitemap: ${host}/sitemap.xml`));
    check('sitemap.xml returns 200', (await get(`${host}/sitemap.xml`)).status === 200);
    for (const from of ['http://menubarreveal.com/', 'https://www.menubarreveal.com/']) {
      const hop = await get(from).catch(() => null);
      check(`${from} answers 301 to ${host}/`, hop?.status === 301 && hop.headers.get('location') === `${host}/`);
    }
  }
});
if (fails.length) stop(`${fails.length} smoke checks failed on ${host}; ${mode === '--live' ? 'the live site was deployed: look at it, and roll back if needed (README, "Roll back")' : 'the live site was not touched'}`);
console.log(`\ndeploy: ${host}/ is up${mode === '--preview' ? '. Look at it, then: npm run deploy -- --live' : ''}`);
