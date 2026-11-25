// The cold load in WebKit and Firefox: node measurements/browsers.mjs <url> [webkit firefox chromium]
// Playwright cannot throttle these engines, so every response is held back as a slow line would hold it
// (165 ms, then its size at about 1 MB a second). Each browser starts on a new profile, at 1858x1033 (1x) and
// 390x844 (2x). A screenshot is taken as fast as the browser gives one for four seconds; each that differs from the one
// before is kept in measurements/browsers/<browser>-<size>/<ms>.png. Prints, per run, when the picture changed,
// and what the console, the page and the network complained about (a policy violation is a console error).
// WebKit logs "Refused to apply a stylesheet" once per screenshot: that is Playwright's own helper style being refused
// by the page's policy, not the page (a load with no screenshot logs nothing).
// Browsers: npx playwright install webkit firefox   (into the user cache)
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as playwright from 'playwright';

const [url, ...names] = process.argv.slice(2);
if (!url) { console.error('usage: node measurements/browsers.mjs <url> [webkit firefox chromium]'); process.exit(1); }
const SIZES = [{ width: 1858, height: 1033, dpr: 1 }, { width: 390, height: 844, dpr: 2 }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const name of names.length ? names : ['webkit', 'firefox']) {
  for (const { width, height, dpr } of SIZES) {
    const out = new URL(`browsers/${name}-${width}x${height}/`, import.meta.url);
    rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
    const browser = await playwright[name].launch();
    const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr })).newPage();
    const complaints = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') complaints.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => complaints.push(`page error: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', (r) => complaints.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) complaints.push(`${r.status()}: ${r.url()}`); });
    await page.route('**/*', async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      await sleep(165 + body.length / 1012.5);
      await route.fulfill({ response, body });
    });
    const start = Date.now(); const frames = []; let last = '';
    const going = page.goto(url, { waitUntil: 'load' }).catch((e) => complaints.push(`navigation: ${e.message.slice(0, 120)}`));
    while (Date.now() - start < 4000) {
      const at = Date.now() - start;
      const shot = await page.screenshot().catch(() => null);
      if (!shot) { await sleep(20); continue; }
      const hash = createHash('sha1').update(shot).digest('hex');
      if (hash !== last) { last = hash; frames.push(at); writeFileSync(new URL(String(at).padStart(5, '0') + 'ms.png', out), shot); }
    }
    await going;
    const mask = await page.evaluate(() => getComputedStyle(document.querySelector('.wall')).maskImage.slice(0, 40));
    console.log(JSON.stringify({ browser: `${name} ${browser.version()}`, size: `${width}x${height}`, changedAt: frames, mask, complaints }));
    await browser.close();
  }
}
