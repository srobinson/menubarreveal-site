// Cold load numbers for one URL: node measurements/lighthouse.mjs <url> <label> [runs]
// Runs Lighthouse (pinned below, fetched by npx) on a new Chrome profile each time, for a desktop and a phone screen,
// with one fixed network profile that is applied, not simulated: DevTools' "Fast 4G" (8100 kbit/s down, 1350 kbit/s up,
// 165 ms added to every request), no CPU slowdown. Writes measurements/results/<label>.json: every run, and for each
// screen the median run by last visual change (largest contentful paint does not see a late background picture). The raw Lighthouse reports are not kept.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIGHTHOUSE = 'lighthouse@12.8.2';
const [url, label, runs = '3'] = process.argv.slice(2);
if (!label) { console.error('usage: node measurements/lighthouse.mjs <url> <label> [runs]'); process.exit(1); }
const CHROME = process.env.CHROME_PATH
  ?? `${process.env.HOME}/.agent-browser/browsers/chrome-156.0.8078.47/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const NETWORK = ['--throttling-method=devtools', '--throttling.requestLatencyMs=165', '--throttling.downloadThroughputKbps=8100',
  '--throttling.uploadThroughputKbps=1350', '--throttling.cpuSlowdownMultiplier=1'];
const SCREENS = {
  desktop: ['--preset=desktop', '--screenEmulation.width=1858', '--screenEmulation.height=1033', '--screenEmulation.deviceScaleFactor=1'],
  phone: ['--form-factor=mobile', '--screenEmulation.mobile', '--screenEmulation.width=390', '--screenEmulation.height=844', '--screenEmulation.deviceScaleFactor=2'],
};

const tmp = mkdtempSync(join(tmpdir(), 'lh-'));
const result = { url, lighthouse: LIGHTHOUSE, network: 'Fast 4G, applied: 8100 kbit/s down, 1350 kbit/s up, 165 ms a request; CPU 1x', screens: {} };
for (const [screen, flags] of Object.entries(SCREENS)) {
  const all = [];
  for (let i = 0; i < +runs; i += 1) {
    const out = join(tmp, `${screen}-${i}.json`);
    execFileSync('npx', ['--yes', LIGHTHOUSE, url, '--quiet', '--output=json', `--output-path=${out}`, '--chrome-flags=--headless=new',
      '--only-categories=performance,accessibility,best-practices,seo', ...flags, ...NETWORK], { env: { ...process.env, CHROME_PATH: CHROME }, stdio: ['ignore', 'ignore', 'inherit'] });
    const r = JSON.parse(readFileSync(out, 'utf8'));
    const ms = (id) => Math.round(r.audits[id].numericValue);
    const requests = r.audits['network-requests'].details.items;
    const seen = r.audits.metrics.details.items[0]; // from the trace's screenshots: when the screen first changed, and last
    all.push({
      ttfb: ms('server-response-time'), fcp: ms('first-contentful-paint'), lcp: ms('largest-contentful-paint'),
      cls: +r.audits['cumulative-layout-shift'].numericValue.toFixed(3), speedIndex: ms('speed-index'),
      firstVisualChange: seen.observedFirstVisualChange, lastVisualChange: seen.observedLastVisualChange,
      kB: Math.round(r.audits['total-byte-weight'].numericValue / 1024), requests: requests.length,
      scores: Object.fromEntries(Object.entries(r.categories).map(([k, c]) => [k, Math.round(c.score * 100)])),
    });
  }
  const median = [...all].sort((a, b) => a.lastVisualChange - b.lastVisualChange)[Math.floor(all.length / 2)];
  result.screens[screen] = { median, runs: all };
  console.log(label, screen, JSON.stringify(median));
}
rmSync(tmp, { recursive: true, force: true });
mkdirSync(new URL('results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`results/${label}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');
