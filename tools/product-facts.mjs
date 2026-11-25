// Checks that the product facts the site states agree with the product itself, so two copies of one fact cannot drift.
//   node tools/product-facts.mjs      exit 0 all agree, 1 any mismatch or unreadable value
// Env: PRODUCT_REPO (default: a menubar-reveal clone beside this repo), PRODUCT_REF (default main).
// The product repo is read only, through `git show <ref>:<path>`; nothing is checked out.
//
// Four facts: the default shortcut, the minimum macOS, the price and the download URL. Each product value comes from
// FACTS.md at the ref when it has a line for the fact, else from the repo's own source of truth. The FACTS.md line
// format, anywhere in the file:
//   - **Default shortcut:** none            (or the shortcut, such as ⌥`)
//   - **Minimum macOS:** 14
//   - **Price:** free                        (or an amount, such as $5)
//   - **Download:** https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>.dmg
// The site values come from the files as served: head meta, JSON-LD, page body text, index.md and llms.txt.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SITE = fileURLToPath(new URL("../", import.meta.url));
const REPO = process.env.PRODUCT_REPO || fileURLToPath(new URL("../../menubar-reveal", import.meta.url));
const REF = process.env.PRODUCT_REF || "main";

const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const show = (path) => git("show", `${REF}:${path}`);
const repoFiles = git("ls-tree", "-r", "--name-only", REF).split("\n").filter(Boolean);
const findFile = (name) => {
  const hits = repoFiles.filter((f) => f === name || f.endsWith(`/${name}`));
  if (hits.length !== 1) throw new Error(`expected one ${name} at ${REF}, found ${hits.length}`);
  return hits[0];
};

// ---------- product side ----------
const factsMd = repoFiles.includes("FACTS.md") ? show("FACTS.md") : "";
const factsMdLine = (label) => {
  const m = factsMd.match(new RegExp(`^[-*]\\s+\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, "mi"));
  return m && { value: m[1], source: `FACTS.md "${label}"` };
};
const plistValue = (key) => show("Info.plist").match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];

const product = {
  // No default: Shortcut.load returns an optional, no Shortcut value is built in source as a fallback, and
  // AppDelegate.registerShortcut asks for one (changeShortcut) when none is saved.
  shortcut() {
    const md = factsMdLine("Default shortcut");
    if (md) return { value: /^(none|no default)\b/i.test(md.value) ? "none" : md.value, source: md.source };
    const shortcutFile = findFile("Shortcut.swift");
    const delegateFile = findFile("AppDelegate.swift");
    const shortcut = show(shortcutFile);
    const delegate = show(delegateFile);
    const fallback = `${shortcut}\n${delegate}`.match(/static\s+(?:let|var)\s+\w+\s*(?::\s*Shortcut\s*)?=\s*Shortcut\([^)]*\)|\?\?\s*(?:Shortcut\(|\.default\b)[^\n]*/);
    if (fallback) return { value: `default in source: ${fallback[0].trim()}`, source: shortcutFile };
    const optionalLoad = /static\s+func\s+load\([^)]*\)\s*->\s*Shortcut\?/.test(shortcut);
    const asks = /func\s+registerShortcut\(\)\s*\{\s*guard\s+let\s+shortcut\s+else\s*\{[^}]*changeShortcut\(\)/.test(delegate);
    const source = `${shortcutFile} Shortcut.load -> Shortcut?; ${delegateFile} registerShortcut: guard let shortcut else { changeShortcut() }`;
    if (optionalLoad && asks) return { value: "none", source };
    throw new Error(`cannot read the shortcut behaviour (${source}): the matcher needs an update`);
  },
  minMacOS() {
    const md = factsMdLine("Minimum macOS");
    if (md) return { value: md.value.match(/\d+(?:\.\d+)?/)?.[0], source: md.source };
    const plist = plistValue("LSMinimumSystemVersion");
    if (plist) return { value: plist.replace(/(\.0)+$/, ""), source: "Info.plist LSMinimumSystemVersion" };
    const m = show("Package.swift").match(/\.macOS\(\s*(?:\.v(\d+(?:_\d+)?)|"([\d.]+)")\s*\)/);
    if (!m) throw new Error("no LSMinimumSystemVersion in Info.plist and no .macOS platform in Package.swift");
    return { value: (m[1] || m[2]).replace("_", ".").replace(/(\.0)+$/, ""), source: `Package.swift platforms ${m[0]}` };
  },
  price() {
    const md = factsMdLine("Price");
    if (md) return { value: /^(free|\$?0(\.00)?)$/i.test(md.value) ? "free" : md.value, source: md.source };
    const license = show("LICENSE").split("\n")[0].trim();
    const readmeFree = show("README.md").match(/[^.\n]*\bfree\b[^.\n]*/i);
    if (!readmeFree) throw new Error(`README.md does not say free (LICENSE: ${license})`);
    return { value: "free", source: `README.md "${readmeFree[0].trim()}"; LICENSE ${license}` };
  },
  async downloadUrl() {
    const md = factsMdLine("Download");
    if (md) return md;
    const version = plistValue("CFBundleShortVersionString");
    if (!version) throw new Error("Info.plist has no CFBundleShortVersionString");
    const remote = git("remote", "get-url", "origin").trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!remote) throw new Error("origin is not a GitHub repo");
    const tag = `v${version}`;
    const res = await fetch(`https://api.github.com/repos/${remote[1]}/${remote[2]}/releases/tags/${tag}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "menubarreveal-site-product-facts" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GitHub release ${tag}: HTTP ${res.status}`);
    const dmgs = (await res.json()).assets.filter((a) => a.name.endsWith(".dmg"));
    const asset = dmgs.find((a) => a.name.includes(version)) ?? (dmgs.length === 1 ? dmgs[0] : null);
    if (!asset) throw new Error(`GitHub release ${tag} has no single versioned .dmg asset`);
    return { value: asset.browser_download_url, source: `Info.plist CFBundleShortVersionString ${version}; GitHub release ${tag} asset ${asset.name}` };
  },
};

// ---------- site side ----------
const read = (name) => readFileSync(join(SITE, name), "utf8");
const html = read("index.html");
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// Every JSON-LD block counts as text; the SoftwareApplication node carries the offer.
const jsonldText = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
const jsonld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => JSON.parse(m[1])).find((n) => n["@type"] === "SoftwareApplication") ?? {};
const texts = [
  ...[...html.matchAll(/<meta\s+(?:name|property)="([^"]*description)"\s+content="([^"]*)"/g)].map((m) => [`meta ${m[1]}`, unescape(m[2])]),
  ["JSON-LD", jsonldText],
  ["page body", unescape(html.replace(/^[\s\S]*?<\/head>/i, "").replace(/<!--[\s\S]*?-->|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, " "))],
  ["index.md", read("index.md")],
  ["llms.txt", read("llms.txt")],
];
const found = (re) => texts.flatMap(([where, t]) => [...t.matchAll(re)].map((m) => ({ where, match: m })));
const describe = (hits) => hits.map((h) => `${h.where}: "${h.match[0]}"`).join("; ");
const distinct = (values) => [...new Set(values)];

const site = {
  shortcut() {
    const hits = found(/backtick|⌥\s*`|\bby default\b|(?<!\bno )\bdefault (?:shortcut|key|hot ?key)\b/gi);
    return hits.length ? `default claimed (${describe(hits)})` : `none (no default claim in ${texts.length} texts)`;
  },
  minMacOS() {
    const hits = found(/macOS (\d+(?:\.\d+)?) or later/g);
    const values = distinct(hits.map((h) => h.match[1]));
    return { values, text: hits.length ? `${values.join(", ")} (${distinct(hits.map((h) => h.where)).join(", ")})` : "not stated" };
  },
  price() {
    const amounts = found(/[$€£]\s?\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?(?:USD|EUR|GBP)\b/g).filter((h) => !/^\D*0(\.0+)?\D*$/.test(h.match[0]));
    const price = String(jsonld.offers?.price);
    const free = price === "0" && jsonld.isAccessibleForFree === true && !amounts.length;
    return free ? "free (JSON-LD offers.price 0 and isAccessibleForFree)"
      : `not free: JSON-LD offers.price ${price}, isAccessibleForFree ${jsonld.isAccessibleForFree}${amounts.length ? `, amounts ${describe(amounts)}` : ""}`;
  },
  downloadUrl() {
    const urls = [
      ["JSON-LD", jsonld.downloadUrl],
      ...[...read("index.md").matchAll(/\]\((https:\/\/[^)\s]*\/releases\/download\/[^)\s]*)\)/g)].map((m) => ["index.md", m[1]]),
      ...[...html.matchAll(/href="(https:\/\/[^"]*\/releases\/download\/[^"]*)"/g)].map((m) => ["page body", unescape(m[1])]),
    ].filter(([, u]) => u);
    const values = distinct(urls.map(([, u]) => u));
    return { values, text: urls.length ? `${values.join(", ")} (${distinct(urls.map(([w]) => w)).join(", ")})` : "not stated" };
  },
};

// ---------- compare ----------
const checks = [
  ["Default shortcut", product.shortcut, () => { const s = site.shortcut(); return { text: s, same: (p) => s.startsWith("none") === (p === "none") }; }],
  ["Minimum macOS", product.minMacOS, () => { const s = site.minMacOS(); return { text: s.text, same: (p) => s.values.length === 1 && s.values[0] === p }; }],
  ["Price", product.price, () => { const s = site.price(); return { text: s, same: (p) => s.startsWith("free") === (p === "free") }; }],
  ["Download URL", product.downloadUrl, () => { const s = site.downloadUrl(); return { text: s.text, same: (p) => s.values.length === 1 && s.values[0] === p }; }],
];

console.log(`product facts: ${REPO} at ${REF} (${git("rev-parse", "--short", REF).trim()}); site ${SITE}`);
let fails = 0;
for (const [name, readProduct, readSite] of checks) {
  let p;
  try { p = await readProduct(); } catch (e) { p = { value: undefined, source: `ERROR ${e.message}` }; }
  const s = readSite();
  const pass = p.value !== undefined && s.same(p.value);
  if (!pass) fails++;
  console.log(`${pass ? "pass" : "FAIL"}  ${name}\n      site:    ${s.text}\n      product: ${p.value ?? "unknown"}\n      source:  ${p.source}`);
}
console.log(fails ? `\nFAIL ${fails} of ${checks.length} product facts disagree with the product repo` : `\nPASS: ${checks.length} product facts agree with the product repo`);
process.exit(fails ? 1 : 0);
