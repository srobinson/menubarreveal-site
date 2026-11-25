// From this folder to the live site. A deploy step, not a build: what is served is the files as they are here,
// copied untouched (the preview copy alone gains a noindex header), and worker.mjs, which answers the home page.
//   npm run deploy                 dry run: every check, then wrangler validates the site and the www Worker; uploads nothing
//   npm run deploy -- --preview    the same checks, then https://preview.menubarreveal.com (noindexed), then a smoke check
//   npm run deploy -- --live       the same checks, then https://menubarreveal.com and the www redirect, then a smoke check
// Order: lint with the facts check and the style hash, the product facts, a clean git tree, wrangler, smoke check.
// It stops at the first step that fails, and it changes no file here: a stale style hash is named by lint, not rewritten. Wrangler uses the logged in Cloudflare account (`npx wrangler login`).
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { root, siteFiles, withNoindex } from './site.mjs';
import { HOSTS, smoke } from './smoke.mjs';

const mode = process.argv[2] ?? '--dry-run';
if (!['--dry-run', '--preview', '--live'].includes(mode)) { console.error('usage: npm run deploy [-- --preview | -- --live]'); process.exit(2); }
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const out = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' });
// However a run ends, the copies made for wrangler do not outlive it.
process.on('exit', () => { rmSync(join(root, '.deploy'), { recursive: true, force: true }); rmSync(join(root, '.preview'), { recursive: true, force: true }); });
let liveStarted = false;
const stop = (why) => {
  console.error(`\ndeploy: STOPPED: ${why}. Nothing after this step ran.`);
  if (mode !== '--dry-run') console.error(liveStarted ? 'deploy: the live deploy had started: look at https://menubarreveal.com, and roll back if needed (README, "Roll back").' : 'deploy: the live site was not touched.');
  process.exit(1);
};
// A step that throws (a check or wrangler exiting non zero) stops the run the same way as one that calls stop.
const step = async (name, fn) => {
  console.log(`\ndeploy: == ${name}`);
  try { return await fn(); } catch (error) { return stop(`"${name}" failed (${error.message.split('\n')[0]})`); }
};
// Wrangler never gets a terminal: its input is closed and its output comes through a pipe. Given a terminal it stops
// to ask before it moves a host that another Worker holds; without one it makes the hosts match the config, as in CI,
// so a run cannot hang on a question.
const wrangler = (...args) => new Promise((done, failed) => {
  const child = spawn('npx', ['wrangler', 'deploy', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.on('error', failed);
  child.on('close', (code) => (code === 0 ? done() : failed(new Error(`npx wrangler deploy ${args.join(' ')} exited ${code}`))));
});

await step('lint, the facts check and the style hash in _headers (npm run lint)', () => run('npm', 'run', '--silent', 'lint'));
await step('the product facts against the product repo (tools/product-facts.mjs)', () => run('node', 'tools/product-facts.mjs'));
if (mode !== '--dry-run') await step('a clean git tree: what goes up is a commit', () => {
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
  await step('the copy that would go up', () => copySite('.deploy'));
  await step('wrangler dry run: the site', () => wrangler('--env=', '--dry-run', '--outdir', tmp));
  await step('wrangler dry run: the www redirect', () => wrangler('--config', 'www-redirect/wrangler.toml', '--dry-run', '--outdir', tmp));
  console.log('\ndeploy: dry run passed. Nothing was uploaded.');
  process.exit(0);
}

if (mode === '--preview') {
  await step('the preview copy: the site, plus X-Robots-Tag: noindex, nofollow on every response', () => {
    // refuse unless wrangler.toml's preview environment names the preview Worker and host and nothing else
    const env = readFileSync(join(root, 'wrangler.toml'), 'utf8').split('[env.preview]')[1] ?? '';
    for (const line of ['name = "menubarreveal-preview"', 'routes = [{ pattern = "preview.menubarreveal.com", custom_domain = true }]', 'directory = "./.preview"']) {
      if (!env.includes(line)) stop(`wrangler.toml [env.preview] lacks: ${line}`);
    }
    copySite('.preview', { noindex: true });
  });
  await step('wrangler deploy: preview only', () => wrangler('--env', 'preview'));
} else {
  await step('the copy that goes up', () => copySite('.deploy'));
  liveStarted = true;
  await step('wrangler deploy: the www redirect', () => wrangler('--config', 'www-redirect/wrangler.toml'));
  await step('wrangler deploy: the site', () => wrangler('--env='));
}

// ---------- the served site against this folder (tools/smoke.mjs) ----------
const host = HOSTS[mode];
const fails = await step(`smoke check ${host}`, () => smoke(mode));
if (fails.length) stop(`${fails.length} smoke checks failed on ${host}`);
console.log(`\ndeploy: ${host}/ is up${mode === '--preview' ? '. Look at it, then: npm run deploy -- --live' : ''}`);
