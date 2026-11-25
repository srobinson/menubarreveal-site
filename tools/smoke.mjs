// The served site against this folder: does the host answer with what is here?
//   node tools/smoke.mjs --preview | --live      (npm run deploy runs it as its last step)
// It only reads. Every request resolves its host over DNS over HTTPS (DOH, default Cloudflare's public resolver), so
// a stale DNS cache on this machine can neither fail a check nor fake one. Needs curl 7.62 or later.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './site.mjs';

export const HOSTS = { '--preview': 'https://preview.menubarreveal.com', '--live': 'https://menubarreveal.com' };
const DOH = process.env.DOH || 'https://cloudflare-dns.com/dns-query';

// One request, redirects not followed: { status, headers, body }, header names in lower case. Status 0: no answer.
const get = (url) => {
  let text;
  try {
    text = execFileSync('curl', ['-sS', '-i', '--doh-url', DOH, '--max-time', '20', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    console.log(`  ${url}: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    return { status: 0, headers: new Map(), body: '' };
  }
  const cut = text.indexOf('\r\n\r\n');
  const [statusLine, ...lines] = text.slice(0, cut).split('\r\n');
  const headers = new Map();
  for (const line of lines) {
    const name = line.slice(0, line.indexOf(':')).toLowerCase();
    const value = line.slice(line.indexOf(':') + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  return { status: Number(statusLine.split(' ')[1]), headers, body: text.slice(cut + 4) };
};

// Runs every check, prints one line each and returns the names of those that failed.
export const smoke = async (mode) => {
  const host = HOSTS[mode];
  const fails = [];
  const check = (name, pass) => { console.log(`  ${pass ? 'pass' : 'FAIL'}  ${name}`); if (!pass) fails.push(name); };
  // one hop: a 301 whose Location, path and query included, is exactly `to`
  const redirect = (from, to) => {
    const hop = get(from);
    check(`${from} answers 301 to ${to}`, hop.status === 301 && new URL(hop.headers.get('location') ?? '', from).href === to);
  };
  // every hop a 301 until a 200 at exactly `to`
  const chain = (from, to) => {
    const statuses = [];
    let url = from;
    for (let i = 0; i < 6; i += 1) {
      const hop = get(url);
      statuses.push(hop.status);
      if (hop.status !== 301) break;
      url = new URL(hop.headers.get('location') ?? '', url).href;
    }
    check(`${from} ends at ${to} (${statuses.join(', ')})`, url === to && statuses.at(-1) === 200);
  };
  const page = readFileSync(join(root, 'index.html'), 'utf8');
  let home;
  for (let i = 0; i < 12; i += 1) { // the edge can take a few seconds to serve the new files
    home = get(`${host}/`);
    if (home.status === 200 && home.body === page) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  check(`${host}/ returns 200`, home.status === 200);
  check(`${host}/ serves this index.html, byte for byte`, home.body === page);
  const policy = readFileSync(join(root, '_headers'), 'utf8').match(/Content-Security-Policy:\s*(.*)/)[1].trim();
  check('the Content-Security-Policy header is the one in _headers', home.headers.get('content-security-policy') === policy);
  const robotsTag = home.headers.get('x-robots-tag') ?? '';
  check('og.jpg returns 200', get(`${host}/og.jpg`).status === 200);
  check('a missing path returns 404', get(`${host}/no-such-page`).status === 404);
  redirect(`${host}/index.html?q=1`, `${host}/?q=1`);
  if (mode === '--preview') check('every response says noindex', /noindex/i.test(robotsTag));
  else {
    check('the home page does not say noindex', !/noindex/i.test(robotsTag));
    const robots = get(`${host}/robots.txt`).body;
    check('robots.txt allows all and names the sitemap', /^Allow: \/$/m.test(robots) && !/^Disallow: \/$/m.test(robots) && robots.includes(`Sitemap: ${host}/sitemap.xml`));
    check('sitemap.xml returns 200', get(`${host}/sitemap.xml`).status === 200);
    redirect('http://menubarreveal.com/', `${host}/`);
    redirect('https://www.menubarreveal.com/', `${host}/`);
    redirect('https://www.menubarreveal.com/llms.txt?utm_source=v&b=2', `${host}/llms.txt?utm_source=v&b=2`);
    chain('http://www.menubarreveal.com/index.html?q=1', `${host}/?q=1`);
  }
  return fails;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!HOSTS[mode]) { console.error('usage: node tools/smoke.mjs --preview | --live'); process.exit(2); }
  console.log(`smoke check ${HOSTS[mode]} (DNS over ${DOH})`);
  const fails = await smoke(mode);
  console.log(fails.length ? `\nFAIL: ${fails.length} checks failed on ${HOSTS[mode]}` : `\nPASS: ${HOSTS[mode]} serves this folder`);
  process.exit(fails.length ? 1 : 0);
}
