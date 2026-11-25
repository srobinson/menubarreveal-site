# menubarreveal.com

The site for [Menu Bar Reveal](https://github.com/srobinson/menubar-reveal): one hand written page. There is no build. What is written here is what is served.

## What is in this folder

**The site** (everything that is deployed):

| File | What it is |
| --- | --- |
| `index.html` | The page: markup, one readable `<style>` block, and the SVG filters the styles call. No script. |
| `assets/art/` | The page's nine pictures. |
| `assets/fonts/` | Anton and Tinos (the page) and Special Elite (the 404 page), with their licences: the first two SIL Open Font Licence, Special Elite Apache 2.0. |
| `404.html`, `assets/404/` | The page for a missing address, its styles and pictures. |
| `favicon.ico`, `favicon.svg`, `favicon-96.png`, `apple-touch-icon.png` | Icons. |
| `og.jpg` | The share image: the page's first screen at 1200x630. |
| `index.md`, `llms.txt` | The product facts as Markdown, for agents. |
| `robots.txt`, `sitemap.xml` | For crawlers. |
| `_headers`, `_redirects` | Response headers, the Content Security Policy among them; and one redirect, `/index.html` to `/`. |

**Dev files** (never deployed; `.assetsignore` lists them for the host):
`README.md`, `package.json`, `package-lock.json`, `.browserslistrc`, `.htmlvalidate.json`, `.stylelintrc.json`, `.assetsignore`, `.gitignore`, `.github/`, `measurements/`, `node_modules/`.

## Change the copy

Open `index.html`. The words on the wall are plain text in `<body>`; change them there.

The same facts are also said out of sight. When they change, change each of these too:

- in `index.html`: `<title>`, the description (`<meta name="description">`, `og:description`, `twitter:description`, and `description` in the JSON-LD block), the share image's alt text, the stage photo's `aria-label` and the waiter picture's `alt`
- `index.md` and `llms.txt`
- on a new release: `softwareVersion` and `downloadUrl` in the JSON-LD block, and the download link in `index.md`
- `sitemap.xml`: the `lastmod` date
- `og.jpg` is a picture of the first screen: if the first screen changes, render it again and rewrite its alt text

Then check your work:

```sh
npm install      # once
npm run lint     # html-validate on both pages; stylelint on the style block and the 404 styles
npm run serve    # http://127.0.0.1:8080, served with the headers it will have live
```

Lint checks for invalid HTML and CSS, and for CSS the supported browsers lack (`.browserslistrc`: the browsers of macOS 14, the app's minimum, and later). It has no formatting rules. GitHub runs the same command on every push (`.github/workflows/lint.yml`).

## Ship

Publishing goes through the launch kit (`launch-kit/` in the studio's shared assets; its `README.md` is the guide). The kit takes a page folder, and this folder is one:

```sh
# from launch-kit/
bash deploy-site.sh --preview /path/to/menubarreveal-site    # build, check and deploy https://preview.menubarreveal.com
WHEATPASTE=/path/to/menubarreveal-site bash build-site.sh     # build site/ for the apex; deploy-site.sh --live ships it
```

What the kit does with this folder: it copies `index.html` and every file the page links, gives those files hashed names, writes the head tags, icons, share image, 404 page, crawl files and `_headers` from its own `site-kit/facts.json`, and adds the sha256 of the page's `<style>` block to `style-src`. So when you publish through the kit, the kit's copies of those files are the ones that go live; keep `site-kit/facts.json` and this folder saying the same thing.

The style hash is not optional. `_headers` here says `style-src 'self'`, which on its own refuses the page's `<style>` block. Never upload this folder without a step that adds the block's sha256 (`measurements/serve.mjs` does the same thing locally, on every request).

## How the page loads

A cold load shows the wall's colour, then the whole page at once. Nothing is white and nothing arrives late:

- the page background is the wall's colour, and the styles are in the page, so the first paint needs no second file
- both fonts are preloaded and use `font-display: block`, so no text is drawn in a fallback face and then swapped
- the wall is masked by its own pictures (`mask-image` on `.wall`). While a mask picture is loading the browser draws nothing of the wall, so wall, posters and type appear together when the last picture is in. After four seconds the mask comes off whatever has loaded.

The pictures are not preloaded with `<link>` tags: the styles ask for them the moment the page is parsed, and a preload for a picture that is also a mask only makes Chrome log a warning.

## Pictures and fonts

Files under `assets/` are cached for a year (`_headers`). A changed file gets a new name; never replace one in place. There is no image tooling here: optimise a picture once, when you add it, and commit only the result.

| File | How it was made |
| --- | --- |
| `mural-1440.avif`, `mural-2880.avif` | The wall, sun at y 300 (phones). Painted by a script at 2880x3000, the small one scaled with Lanczos; `avifenc -q 62 -s 4`. |
| `mural-sun450-1440.avif`, `mural-sun450-2880.avif` | The same wall with the sun at y 450 (wide screens); made the same way. |
| `wall-relief.webp` | The wall's blockwork as light and shade, 1440x1500, in register with the mural. From the v13 design as it was; encoder settings not recorded. |
| `plate.webp` | The stage in the front page photo, 1100x1540. From v13 as it was; settings not recorded. |
| `crease-flyer.webp` | The front page's creases, 640x1040. From v13 as it was; settings not recorded. |
| `grime.webp` | Paper grime, a 900x900 tile. From v13 as it was; settings not recorded. |
| `ply-halftone.webp` | The waiter, 500x800. From v13 as it was; settings not recorded. |
| `Anton-400.woff2`, `Tinos-700.woff2` | Latin subsets (232 and 235 characters) as WOFF2, from v13 as they were. SIL Open Font Licence, in `assets/fonts/licences/`. |
| `SpecialElite-400.woff2`, `assets/404/*` | The 404 page's face (Apache 2.0, in `assets/fonts/licences/`) and pictures, as the live site served them on 2026-11-25. |

Every picture the wall is masked by must be opaque: one with see through parts would cut holes in the page.

## Measurements

`measurements/` holds the checks behind this page and their results: `serve.mjs` (the local server), `parity.sh` (pixel comparison with the frozen v13 design), `lighthouse.mjs` (cold load numbers on one fixed network profile), `film.mjs` (a cold load in Chrome, frame by frame), `browsers.mjs` (the same in WebKit and Firefox, with Playwright). `measurements/results.md` is the summary.
