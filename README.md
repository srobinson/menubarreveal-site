# menubarreveal.com

The site for [Menu Bar Reveal](https://github.com/srobinson/menubar-reveal): one hand written page. There is no build. The files in this folder are the files that are served.

## What is in this folder

**The site** (everything that is served):

| File | What it is |
| --- | --- |
| `index.html` | The page: markup, one readable `<style>` block, and the SVG filters the styles call. No script. |
| `assets/art/` | The page's pictures. |
| `assets/fonts/` | Anton and Tinos (the page) and Special Elite (the 404 page), with their licences. |
| `404.html`, `assets/404/` | The page for a missing address, its styles and pictures. |
| `favicon.ico`, `favicon.svg`, `favicon-96.png`, `apple-touch-icon.png` | Icons. |
| `og.jpg` | The share image: the page's first screen at 1200x630. |
| `index.md`, `llms.txt` | The product facts as Markdown, for agents. |
| `robots.txt`, `sitemap.xml` | For crawlers. |
| `_headers`, `_redirects` | Response headers, the Content Security Policy among them; and one redirect, `/index.html` to `/`. |

**Dev files** (never served; `.assetsignore` is the list):

| File | What it is |
| --- | --- |
| `facts.json` | The product facts, once. Every copy of a fact in the site is checked against it. |
| `tools/check.mjs`, `tools/csp.mjs` | The checks behind `npm run lint`, and the style hash in `_headers`. |
| `tools/deploy.mjs`, `tools/product-facts.mjs`, `wrangler.toml`, `www-redirect/` | The deploy step, its check against the app's own repo, and the Cloudflare configuration for the site and the `www` redirect. |
| `tools/serve.mjs` | The site on your machine, with its real headers. |
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

The check covers the title, the descriptions, the share tags, both JSON-LD blocks, `index.md`, `llms.txt`, `sitemap.xml`, `robots.txt` and the 404 page. It writes nothing. It also fails if a page names a file that is not here, or if the style hash in `_headers` is stale.

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

1. The style hash in `_headers` is brought up to date.
2. `npm run lint`.
3. `tools/product-facts.mjs` reads the app's repo and checks four facts the site states against it: no default shortcut, the minimum macOS, the price, and the download URL of the current release.
4. For a real deploy, the git tree must be clean: what goes up is a commit.
5. Wrangler uploads a copy of the tracked files minus the dev files. The preview copy gains one header, `X-Robots-Tag: noindex, nofollow`; the live copy is untouched.
6. A smoke check of the served site: `/` is this `index.html` byte for byte, the policy header is the one in `_headers`, `/index.html` redirects, a missing path is a 404, and on the live site `http://` and `www` answer 301 to the apex.

Run the preview first, look at it, then go live.

### Roll back

Find a version with `npx wrangler deployments list --name menubarreveal`, then:

```sh
npx wrangler rollback <version-id> --name menubarreveal -m "<reason>"
```

A rollback switches the Worker to the earlier upload; it does not change this folder. To make it stick, revert the commit and deploy again. The preview Worker is `menubarreveal-preview`, the redirect is `menubarreveal-www`.

### Analytics

Cloudflare Web Analytics is added by the zone at the edge, so the beacon is not in `index.html` and never runs locally. The policy in `_headers` allows exactly that script and its reports.

## How the page loads

A cold load shows the wall's colour, then the whole page at once. Nothing is white and nothing arrives late:

- the page background is the wall's colour, and the styles are in the page, so the first paint needs no second file
- both fonts are preloaded and use `font-display: block`, so no text is drawn in a fallback face and then swapped
- the wall is masked by its own pictures (`mask-image` on `.wall`). While a mask picture is loading the browser draws nothing of the wall, so wall, posters and type appear together when the last picture is in. After four seconds the mask comes off whatever has loaded.

The pictures are not preloaded with `<link>` tags: the styles ask for them the moment the page is parsed, and a preload for a picture that is also a mask only makes Chrome log a warning. A phone gets the middle strip of the wall, which is all it shows.

## Pictures and fonts

Files under `assets/` are cached for a year (`_headers`). A changed file gets a new name; never replace one in place. Optimise a picture once, when you add it, and commit only the result. Every picture the wall is masked by must be opaque: one with see through parts would cut holes in the page.

| File | How it was made |
| --- | --- |
| `mural-strip-692.avif`, `mural-strip-1384.avif` | The wall for phones, sun at y 300: the middle 692 of its 1440 px. `bash tools/mural/art.sh` paints it (seeded, 2880x3000), crops it and encodes it with `avifenc -q 62 -s 4`. |
| `mural-sun450-1440.avif`, `mural-sun450-2880.avif` | The whole wall for wide screens, sun at y 450. The same script, the same settings. |
| `wall-relief.webp` | The wall's blockwork as light and shade, 1440x1500, lossy WebP. As it came from the design; its source and encoder settings were not kept. |
| `plate.webp` | The stage in the front page photo, 1100x1540, lossless WebP. As it came; source not kept. |
| `crease-flyer.webp` | The front page's creases, 640x1040, lossy WebP. As it came; source and settings not kept. |
| `grime.webp` | Paper grime, a 900x900 tile, lossy WebP. As it came; source and settings not kept. |
| `ply-halftone.webp` | The waiter, 500x800, lossy WebP. As it came; source and settings not kept. |
| `Anton-400.woff2`, `Tinos-700.woff2` | Latin subsets (232 and 235 characters) as WOFF2, as they came. SIL Open Font Licence. |
| `SpecialElite-400.woff2`, `assets/404/*` | The 404 page's face (Apache 2.0) and pictures, as they came. |

`art.sh` reproduces the four wall pictures byte for byte with libavif 1.4.2 and aom 3.15.3; another encoder version may give different bytes for the same painting. The painter draws its figures from the silhouettes in `tools/mural/src/`.

## Licence

The code is under the MIT licence (`LICENSE`). The artwork and the characters are not: they are all rights reserved (`NOTICE`). The fonts keep their own licences, in `assets/fonts/licences/`.
