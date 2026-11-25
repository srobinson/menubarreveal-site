// A cold load filmstrip: node measurements/film.mjs <url> <width> <height> <dpr> <out dir> [--no-throttle] [--block <url part>]
// Starts headless Chrome on a new, empty profile (cold cache, cold connection; the cache itself stays on, as for a visitor), throttles the
// network to DevTools' "Fast 4G" (9 Mbit/s down and 1.5 Mbit/s up, each times 0.9; 165 ms added to every request),
// records every presented frame and a performance trace, and writes into <out dir>:
//   frames/<ms>.jpg   every frame Chrome presented (Page.startScreencast) that differs from the one before; the name is ms after navigation start
//   strip.png         those frames side by side, each under its time
//   timeline.json     the paints (first paint, first contentful paint, largest contentful paint), every request with
//                     its start and finish, console and Log entries (policy violations land in Log), failed requests
// --block: fail every request whose URL holds that text (to see what the page does when a file never comes).
// Chrome: CHROME_PATH, or the Chrome for Testing that agent-browser keeps. Port: the one Chrome picks (never a fixed one).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, W, H, DPR, out, ...flags] = process.argv.slice(2);
if (!out) { console.error('usage: node film.mjs <url> <width> <height> <dpr> <out dir> [--no-throttle] [--block <url part>]'); process.exit(1); }
const throttle = !flags.includes('--no-throttle');
const block = flags.includes('--block') ? flags[flags.indexOf('--block') + 1] : null;
const CHROME = process.env.CHROME_PATH
  ?? `${process.env.HOME}/.agent-browser/browsers/chrome-156.0.8078.47/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const FAST_4G = { offline: false, latency: 60 * 2.75, downloadThroughput: 9e6 / 8 * 0.9, uploadThroughput: 1.5e6 / 8 * 0.9 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'film-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars',
  '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', stop);

let portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await sleep(100);
const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0; const waiting = new Map(); const listeners = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { const { ok, bad } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? bad(new Error(msg.error.message)) : ok(msg.result); }
  else if (msg.method) listeners.forEach((f) => f(msg));
};
const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { id += 1; waiting.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);

const requests = new Map(); const casts = []; const logs = []; const failed = []; const trace = []; let loaded = false; let traceDone;
const traced = new Promise((r) => { traceDone = r; });
listeners.push((msg) => {
  const p = msg.params;
  if (msg.method === 'Tracing.dataCollected') trace.push(...p.value);
  else if (msg.method === 'Tracing.tracingComplete') traceDone();
  else if (msg.sessionId !== sessionId) return;
  else if (msg.method === 'Network.requestWillBeSent') requests.set(p.requestId, { url: p.request.url, type: p.type, priority: p.request.initialPriority, start: p.timestamp, wall: p.wallTime });
  else if (msg.method === 'Network.responseReceived') Object.assign(requests.get(p.requestId) ?? {}, { status: p.response.status, type: p.type });
  else if (msg.method === 'Network.loadingFinished') Object.assign(requests.get(p.requestId) ?? {}, { end: p.timestamp, bytes: p.encodedDataLength });
  else if (msg.method === 'Network.loadingFailed') { const r = requests.get(p.requestId) ?? {}; Object.assign(r, { end: p.timestamp, failed: p.blockedReason ?? p.errorText }); failed.push({ url: r.url, why: r.failed }); }
  else if (msg.method === 'Log.entryAdded') logs.push({ from: 'log', level: p.entry.level, source: p.entry.source, text: p.entry.text.slice(0, 300), url: p.entry.url });
  else if (msg.method === 'Runtime.consoleAPICalled') logs.push({ from: 'console', level: p.type, text: p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300) });
  else if (msg.method === 'Runtime.exceptionThrown') logs.push({ from: 'exception', level: 'error', text: p.exceptionDetails.text });
  else if (msg.method === 'Page.loadEventFired') loaded = true;
  else if (msg.method === 'Page.screencastFrame') { casts.push({ wall: p.metadata.timestamp, data: p.data }); page('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {}); }
});

await page('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: +DPR, mobile: +W < 700 });
await page('Page.enable'); await page('Network.enable'); await page('Log.enable'); await page('Runtime.enable');
if (throttle) await page('Network.emulateNetworkConditions', FAST_4G);
if (block) await page('Network.setBlockedURLs', { urls: [`*${block}*`] });
await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'loading', 'blink.user_timing'] } });
await page('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 640, maxHeight: 1400, everyNthFrame: 1 });
await sleep(500);
await page('Page.navigate', { url });
for (let i = 0; i < 300 && !loaded; i += 1) await sleep(100);
await sleep(block ? 9000 : 2500); // late paints: a font swap, a decoded image, the gate's time limit when a file is blocked
await send('Tracing.end'); await traced;

// ---------- read the trace ----------
const nav = trace.filter((e) => e.name === 'navigationStart' && e.args?.data?.documentLoaderURL?.startsWith(url.split('#')[0])).sort((a, b) => a.ts - b.ts)[0];
if (!nav) { console.error('no navigationStart for', url); process.exit(1); }
const ms = (ts) => Math.round((ts - nav.ts) / 1000);
const mark = (name) => { const e = trace.filter((x) => x.name === name && x.ts >= nav.ts).sort((a, b) => a.ts - b.ts); return e.length ? ms(e[name.startsWith('largest') ? e.length - 1 : 0].ts) : null; };
const paints = { firstPaint: mark('firstPaint'), firstContentfulPaint: mark('firstContentfulPaint'), largestContentfulPaint: mark('largestContentfulPaint::Candidate'), load: mark('loadEventEnd') };

rmSync(join(out, 'frames'), { recursive: true, force: true }); mkdirSync(join(out, 'frames'), { recursive: true });
// the request clock: Network timestamps are seconds on the trace's clock; a screencast frame carries wall clock time,
// which the document request (it has both) ties to that clock
const t0 = nav.ts / 1e6;
const doc = [...requests.values()].find((r) => r.type === 'Document' && r.url.split('#')[0] === url.split('#')[0]);
const wall0 = doc.wall - (doc.start - t0);
const frames = []; let last = null;
for (const c of casts) {
  const at = Math.round((c.wall - wall0) * 1000);
  if (at < 0 || c.data === last) continue;
  last = c.data;
  const name = String(at).padStart(5, '0') + 'ms.jpg';
  writeFileSync(join(out, 'frames', name), Buffer.from(last, 'base64'));
  frames.push(name);
}
const reqs = [...requests.values()].filter((r) => !r.url.startsWith('data:')).map((r) => ({
  start: Math.round((r.start - t0) * 1000), end: r.end ? Math.round((r.end - t0) * 1000) : null, status: r.status ?? null,
  kb: r.bytes ? +(r.bytes / 1024).toFixed(1) : null, type: r.type, priority: r.priority, failed: r.failed, url: r.url.replace(/^https?:\/\/[^/]+/, ''),
})).sort((a, b) => a.start - b.start);
writeFileSync(join(out, 'timeline.json'), JSON.stringify({
  url, viewport: `${W}x${H} @${DPR}x`, throttle: throttle ? 'Fast 4G: 1012.5 kB/s down, 168.75 kB/s up, 165 ms a request' : 'none',
  blocked: block, paints, frames, requests: reqs, failedRequests: failed, notOk: reqs.filter((r) => r.status && r.status >= 400), logs,
}, null, 1));
if (frames.length) {
  const shown = frames.length > 14 ? frames.filter((_, i) => i < 13 || i === frames.length - 1) : frames;
  execFileSync('magick', ['montage', ...shown.flatMap((f) => ['-label', f.replace(/^0+(?=\d)/, '').replace('.jpg', ''), join(out, 'frames', f)]),
    '-tile', `${shown.length}x1`, '-geometry', '+6+6', '-background', '#222', '-fill', '#fff', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '15', join(out, 'strip.png')]);
}
console.log(JSON.stringify({ out, paints, frames: frames.length, requests: reqs.length, failed: failed.length, notOk: reqs.filter((r) => r.status >= 400).map((r) => r.url), logs: logs.length }));
ws.close(); stop(); process.exit(0);
