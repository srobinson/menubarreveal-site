# menubarreveal.com

The site for [Menu Bar Reveal](https://github.com/srobinson/menubar-reveal): one hand written page. There is no build: the files in this folder are the files that are served. One step runs by hand, when a picture changes (`npm run art`), and its results are committed like any other file.

## What is in this folder

**The site** (everything that is served):

| File | What it is |
| --- | --- |
| `index.html` | The page: markup, one readable `<style>` block, and the SVG filters the styles call. No script. The art step writes the pictures' names and previews into it, between two marks. |
| `assets/art/` | The page's pictures, each named with a digest of its bytes. |
| `assets/fonts/` | Anton and Tinos (the page) and Special Elite (the 404 page), with their licences. |
| `404.html`, `assets/404/` | The page for a missing address, its styles and pictures. |
| `favicon.ico`, `favicon.svg`, `favicon-96.png`, `apple-touch-icon.png` | Icons. |
| `og.jpg` | The share image: the page's first screen at 1200x630. |
| `index.md`, `llms.txt` | The product facts as Markdown, for agents. The home page answers with `index.md` when a client asks for Markdown (below, "Markdown at the home page"). |
| `robots.txt`, `sitemap.xml` | For crawlers. |
| `_headers`, `_redirects` | Response headers, the Content Security Policy among them; and one redirect, `/index.html` to `/`. |

**Dev files** (never served; `.assetsignore` is the list):

| File | What it is |
| --- | --- |
| `facts.json` | The product facts, once. Every copy of a fact in the site is checked against it. |
| `tools/check.mjs`, `tools/csp.mjs` | The checks behind `npm run lint`, and the style hash in `_headers`. |
| `tools/deploy.mjs`, `tools/product-facts.mjs`, `wrangler.toml`, `www-redirect/` | The deploy step, its check against the app's own repo, and the Cloudflare configuration for the site and the `www` redirect. |
| `worker.mjs` | The one script Cloudflare runs, and only for `/`: it picks the page or `index.md` by the request's `Accept` header. |
| `tools/smoke.mjs` | The check of the served site against this folder: the deploy's last step, and a command of its own. |
| `tools/serve.mjs` | The site on your machine, with its real headers, and `worker.mjs` answering `/` as it does live. |
| `tools/site.mjs` | What those tools share: which files are the site (`.assetsignore`) and which headers a path gets (`_headers`). |
| `tools/art.mjs` | The art step, `npm run art`: names each picture for its bytes and writes its preview into the page. Run when a picture changes. |
| `tools/mural/` | The painter the wall came from, and the script that remakes its pictures. |
| `package.json`, `package-lock.json`, `.browserslistrc`, `.htmlvalidate.json`, `.stylelintrc.json`, `.github/` | Lint: its tools, its settings, and the workflow that runs it on every push. |
| `LICENSE`, `NOTICE`, `README.md` | The licence, what it does not cover, and this file. |

## Change the copy

The words on the wall are plain text in the `<body>` of `index.html`. Change them there.

The facts the page states out of sight are written once in `facts.json` and by hand in each place that says them. To change one, change `facts.json` first, then run the check: it names every place that now disagrees.

```sh
npm install      # once
npm run lint     # html-validate, stylelint, then tools/check.mjs
```

The check covers the title, the headline (the page's h1, also in `index.md` and `llms.txt`), the descriptions, the share tags, both JSON-LD blocks, `index.md`, `llms.txt`, `sitemap.xml`, `robots.txt` and the 404 page. It writes nothing. It also fails if a page names a file that is not here, if a picture's name does not carry the digest of its bytes, or if the style hash in `_headers` is stale.

Three things it cannot see:

- If you edit the `<style>` block, run `npm run csp`. The Content Security Policy allows the block by the sha256 of its text, and that command writes the new hash into `_headers`.
- `og.jpg` is a picture of the first screen. If the first screen changes, render it again (1600x840 at 2x, scaled to 1200x630) and rewrite its alt text in `facts.json`.
- `sitemap.xml` carries a `lastmod` date. Change it when the page changes in a way a search engine should notice.

To look at the site as it will be served, headers included:

```sh
npm run serve    # http://127.0.0.1:8080
```

Lint has no formatting rules. It checks for invalid HTML and CSS, and for CSS the supported browsers lack (`.browserslistrc`: the browsers of macOS 14, the app's minimum, and later).

## Ship

One command, three modes. It needs Node 22 or later, a Cloudflare login (`npx wrangler login`), and a clone of [menubar-reveal](https://github.com/srobinson/menubar-reveal) beside this folder (or `PRODUCT_REPO` pointing at one).

```sh
npm run deploy                 # dry run: every check, then wrangler validates; uploads nothing
npm run deploy -- --preview    # https://preview.menubarreveal.com, noindexed
npm run deploy -- --live       # https://menubarreveal.com, and the www redirect
```

Each mode runs the same steps in order and stops at the first that fails:

1. `npm run lint`, which also fails on a stale style hash in `_headers` and says how to fix it. The deploy changes no file in this folder.
2. `tools/product-facts.mjs` reads the app's repo and checks four facts the site states against it: no default shortcut, the minimum macOS, the price, and the download URL of the current release.
3. For a real deploy, the git tree must be clean: what goes up is a commit.
4. Wrangler uploads a copy of the tracked files minus the dev files. The preview copy gains one header, `X-Robots-Tag: noindex, nofollow`; the live copy is untouched. Wrangler is run without a terminal, so it never stops to ask: the Workers' hosts are made to match the two `wrangler.toml` files.
5. A smoke check of the served site (`tools/smoke.mjs`): `/` is this `index.html` byte for byte; five paths carry every header `_headers` gives them, the policy among them; `/` asked for as Markdown is this `index.md` byte for byte, with its headers, and both answers say `Vary: Accept`; `/index.html` redirects to `/` and keeps its query; a missing path is a 404; `robots.txt` allows crawling; the preview says noindex and the live site does not; and on the live site `http://` and `www` answer 301 to the same path and query on the apex.

A run that stops names the step that failed, removes the copy it made for wrangler, and says whether the live deploy had started.

Run the preview first, look at it, then go live.

To check the served site against this folder again without deploying, `node tools/smoke.mjs --preview` or `--live`. It only reads. It needs curl, and resolves the hosts over DNS over HTTPS, so a stale DNS cache on your machine can neither fail it nor fake it.

### Roll back

Find a version with `npx wrangler deployments list --name menubarreveal`, then:

```sh
npx wrangler rollback <version-id> --name menubarreveal -m "<reason>"
```

A rollback switches the Worker to the earlier upload; it does not change this folder. To make it stick, revert the commit and deploy again. The preview Worker is `menubarreveal-preview`, the redirect is `menubarreveal-www`.

### Markdown at the home page

The home page has two representations at one address. A request to `/` whose `Accept` header names `text/markdown` gets `index.md`, as `text/markdown; charset=utf-8`; every other request, a browser's among them, gets the page as before. Both answers say `Vary: Accept`, so a cache keeps them apart.

```sh
curl -H 'Accept: text/markdown' https://menubarreveal.com/
```

`worker.mjs` does this, in about 40 lines. `wrangler.toml` runs it for `/` alone (`run_worker_first = ["/"]`), so every other path is answered by the files without it. It reads both answers from the files, so each carries the headers `_headers` gives its file, the security headers among them. One difference: `_headers` marks the file `/index.md` noindex, as a duplicate of the page, and the Markdown answer at `/` does not carry that, because there it is the home page. Markdown wins when `text/markdown` is named with a weight above zero and no smaller than `text/html`'s; `*/*` alone does not ask for it.

### Analytics

Cloudflare Web Analytics is added by the zone at the edge, so the beacon is not in `index.html` and never runs locally. The policy in `_headers` allows exactly that script and its reports.

## How the page loads

A cold load shows the wall's colour for an instant, then the whole page with a soft preview of every picture, then each picture as it arrives. Nothing is white, nothing moves, and the words can be read from the first paint:

- the page background is the wall's colour, and the styles are in the page, so the first paint needs no second file
- both fonts are preloaded and use `font-display: block`, so no text is drawn in a fallback face and then swapped
- a 24 px preview of every picture is in the styles as a data URL, so it is painted with the page
- each picture is hung as two background layers, the file over its preview. A browser draws nothing of a layer whose file is still loading, so the preview shows; when the file is in, it covers the preview. Every picture is opaque, so no preview shows through afterwards. If a file never comes, its preview stays.

Chrome and Firefox have the previews in their first paint. WebKit draws no picture in its first paint, not even an inline one: for about half a second it shows the wall's colour and blank paper, then the previews (seen in WebKit 26.4).

There is no script in this, and no fade: the picture replaces its preview in one paint. The pictures are not preloaded with `<link>` tags: the styles ask for them the moment the page is parsed. A phone gets the middle strip of the wall, which is all it shows.

## Pictures and fonts

Files under `assets/` are cached for a year (`_headers`), so a picture's file name carries a digest of its bytes (`plate.80b622ae8a0a354e.webp`): a changed picture has a new address, and nothing is ever replaced in place. The page also carries a tiny preview of each picture, 24 px wide, inside its styles. The art step writes both.

### The art step

Run `npm run art` when a picture changes, and commit what it writes. Nothing else runs it: a deploy serves the committed files. It is `tools/art.mjs`, about 80 lines over [Eleventy Image](https://www.11ty.dev/docs/plugins/image/) (pinned in `package.json`), and for each picture in the list at its top it:

1. takes the bytes to serve: a plain named file you put in `assets/art/` (`plate.webp`, already optimised), or else the committed file as it is
2. names the file with the digest of those bytes and removes the file it replaces
3. makes the 24 px WebP preview from those bytes
4. writes the names and the previews into `index.html` as custom properties, `--plate` and `--plate-preview`, between the `art:start` and `art:end` marks in the `:root` rule; renames any other mention of the file, such as an `<img src>`; and brings the style hash in `_headers` up to date

So, to change a picture: optimise it, put it in `assets/art/` under its plain name, run `npm run art`, look at the page, commit. To add one: add a line to `PICTURES` in `tools/art.mjs`, run the step, and hang the picture in the styles as two layers, the file over its preview:

```css
background: var(--plate) 0 0 / 100% 100%, var(--plate-preview) 0 0 / 100% 100%;
```

Every picture must be opaque, so that it covers its preview. The step can also encode a picture itself: give its entry a lossless `master`, the `widths` and the `encode` options (the top of `tools/art.mjs` says how). The four wall pictures are made that way.

### Where each file came from

A file's name in the repo has the digest before its extension.

| File | How it was made |
| --- | --- |
| `mural-strip-692.avif`, `mural-strip-1384.avif` | The wall for phones, sun at y 300: the middle 692 of its 1440 px. `bash tools/mural/art.sh` paints it (seeded, 2880x3000) and leaves the strip as a lossless master in `tools/mural/masters/` (not committed); `npm run art` encodes both widths from it with Sharp's AVIF at quality 50, effort 4. |
| `mural-sun450-1440.avif`, `mural-sun450-2880.avif` | The whole wall for wide screens, sun at y 450. The same two steps, the same settings. |
| `wall-relief.webp` | The wall's blockwork as light and shade, 1440x1500, lossy WebP. As it came from the design; its source and encoder settings were not kept. |
| `plate.webp` | The stage in the front page photo, 1100x1540, lossless WebP. As it came; source not kept. |
| `crease-flyer.webp` | The front page's creases, 640x1040, lossy WebP. As it came; source and settings not kept. |
| `grime.webp` | Paper grime, a 900x900 tile, lossy WebP. As it came; source and settings not kept. |
| `ply-halftone.webp` | The waiter, 500x800, lossy WebP. As it came; source and settings not kept. |
| `Anton-400.woff2`, `Tinos-700.woff2` | Latin subsets (232 and 235 characters) as WOFF2, as they came. SIL Open Font Licence. |
| `SpecialElite-400.woff2`, `assets/404/*` | The 404 page's face (Apache 2.0) and pictures, as they came. The art step does not touch them. |

With the masters on disk and the pinned Eleventy Image (Sharp 0.35.5), `npm run art` gives the same bytes each time, so the names do not change; another Sharp version may give different bytes for the same painting. Without the masters it leaves the committed wall pictures as they are. The painter draws its figures from the silhouettes in `tools/mural/src/`.

## Licence

The code is under the MIT licence (`LICENSE`). The artwork and the characters are not: they are all rights reserved (`NOTICE`). The fonts keep their own licences, in `assets/fonts/licences/`.
