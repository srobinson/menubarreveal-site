Written by tm/frontend (claude-fable-5-2).

# Measurements, 2026-11-25

All numbers are cold loads in Chrome for Testing 156 on one fixed network profile, applied and not simulated:
DevTools "Fast 4G" (8100 kbit/s down, 1350 kbit/s up, 165 ms added to every request), no CPU slowdown.
Lighthouse 12.8.2, three runs a screen, the median run by last visual change (`lighthouse.mjs`; every run is in `results/`).
Desktop is 1858x1033 at 1x, phone is 390x844 at 2x.

## Before and after

| | Live site before | Old build, local | This repo, local |
| --- | --- | --- | --- |
| **Desktop** | | | |
| TTFB | 32 ms | 1 ms | 1 ms |
| First visual change | 568 ms | 537 ms | 300 ms |
| FCP | 565 ms | 535 ms | 299 ms |
| LCP | 565 ms | 535 ms | 444 ms |
| Last visual change | 1238 ms | 1185 ms | 1254 ms |
| Speed Index | 781 | 722 | 1245 |
| CLS | 0 | 0 | 0 |
| Total bytes | 822 kB | 845 kB | 786 kB |
| Requests | 18 | 16 | 12 |
| **Phone** | | | |
| TTFB | 90 ms | 1 ms | 1 ms |
| First visual change | 609 ms | 506 ms | 744 ms |
| FCP | 608 ms | 504 ms | 313 ms |
| LCP | 608 ms | 504 ms | 449 ms |
| Last visual change | 1828 ms | 1710 ms | 1779 ms |
| Speed Index | 954 | 816 | 1779 |
| CLS | 0 | 0 | 0 |
| Total bytes | 1322 kB | 1344 kB | 1285 kB |
| Requests | 18 | 16 | 12 |

- "Live site before" is https://menubarreveal.com as deployed (the v13 build), over the real network plus the profile.
- "Old build, local" is `prerelease/dist` on a local server with its strict CSP and no compression: the like for like baseline.
- "This repo, local" is this folder from `serve.mjs`: `_headers` applied, the style block's sha256 added to `style-src` the way the publish step does it, Brotli for text.
- Lighthouse scores, before and after: performance 100 and 99 (desktop), 100 and 100 (phone); accessibility 100; best practices 100; SEO 92.

How to read it. The files are the same size as before, so the whole page arrives at about the same time (last visual change).
What changed is what is on screen until then. Before: white for about 0.55 s, then the page in stages (bare poster, textures
and the standfirst's face, the wall, the relief). After: the wall's colour from 0.3 s, then the whole page in one frame.
Speed Index is higher because it rewards showing parts early, which is exactly what the page no longer does.
FCP and LCP are reported early because Chrome counts text drawn under the mask; the last visual change is when a visitor sees the page.
The phone's "first visual change" of 744 ms is Lighthouse's sampling of its own screenshots; the filmstrip below has the wall colour at 298 ms.

## One cold load, frame by frame

`film.mjs`, same profile, every frame Chrome presented that differs from the one before:

| Screen | Frames | Files |
| --- | --- | --- |
| 1858x1033 | 2: the wall's colour at 310 ms, the whole page at 1177 ms | `filmstrip/1858x1033/strip.png`, `frames/`, `timeline.json` |
| 390x844 | 2: the wall's colour at 298 ms, the whole page at 1714 ms | `filmstrip/390x844/strip.png`, `frames/`, `timeline.json` |

In both: 11 requests, all 200; 0 failed or blocked requests; 0 entries in Chrome's console or Log (policy violations land in Log); 0 page errors.
The header enforced for these runs: `default-src 'none'; script-src 'none'; img-src 'self' data:; style-src 'self' 'sha256-<the style block>'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`. Since then `_headers` also allows the Cloudflare Web Analytics beacon (`script-src https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com`), which the zone adds at the edge and which never runs locally.
A wrong hash is caught: when the page changed under a server holding an old hash, Chrome refused the style block and the page rendered unstyled.

With one picture blocked (`--block wall-relief`) the wall still shows, without that picture, once the others are in.
With all pictures in, the mask is off after four seconds (`mask-image` computes to `none`).

## WebKit and Firefox

`browsers.mjs` (Playwright 1.59.1), cold profile, every response held back like a slow line, the policy enforced, screenshots as fast as the browser gives them:

| Browser | 1858x1033 | 390x844 at 2x |
| --- | --- | --- |
| WebKit 26.4 | one paint: the wall's colour at 318 ms, the whole page at 740 ms | one paint: 256 ms, then 708 ms |
| Firefox 148.0.2 | one paint: the wall's colour at 301 ms, the whole page at 908 ms | one paint: 266 ms, then 1258 ms |

Neither showed a stage or a broken page, and neither logged an error of the page's own (WebKit's "Refused to apply a stylesheet" is Playwright's screenshot helper; a load without screenshots logs nothing).
The times are not comparable with Chrome's above: here each response is delayed on its own, with no shared line.
Locally `serve.mjs` leaves `upgrade-insecure-requests` out of the policy: over plain http WebKit obeys it even on 127.0.0.1 and every file request fails. On the https site the directive changes nothing.

## Pixel parity with v13

`parity.sh`: full page screenshots of `prerelease/v13` and this page, compared pixel by pixel.

| Screen | Differing pixels | Largest difference | Files |
| --- | --- | --- | --- |
| 1858x1033 (1858x1778 px) | 1 | 1 of 255 | `parity/1858x1033-v13.png`, `-new.png`, `-diff.png` |
| 1440x900 (1440x1428 px) | 0 | 0 | `parity/1440x900-*.png` |
| 390x844 at 2x (780x1900 px) | 0 | 0 | `parity/390x844-*.png` |

v13 against itself is not perfectly stable: three shots of v13 at 1440x900 differed from each other by 3 to 6 pixels, by 1 of 255. One pixel is inside that noise.
An earlier pass had about 1500 pixels off by up to 2 inside the front page photo: the mask was stretched over the wall, which made Chrome decode the stage picture at full size and resample it. The mask is now small tiles (`mask-size: 16px 16px`), which leaves each picture's own decode alone.

## The launch kit's build of this folder

`site-kit/kit.mjs` run on this folder into a temporary folder (the kit was read, not changed): it took the page, renamed its 11 art and font files with hashes,
wrote `style-src 'self' 'sha256-…'` for the rewritten style block, and the result, served under the kit's own `_headers`, loaded cold in two frames with
no policy violation and matched v13 at 1858x1033 within one pixel. Its favicons and share image come from `build-site.sh`, which was not run.

## The live site's compression

`curl -H 'Accept-Encoding: …' https://menubarreveal.com/`, 2026-11-25: Brotli 33,377 bytes, zstd 34,425, gzip 34,636, none 61,675. So the host compresses HTML; nothing here needs a compression step.

## Images are not in git

`parity/`, `filmstrip/` and `browsers/` are written by the scripts and ignored by git: run `bash measurements/parity.sh <url>` and `node measurements/film.mjs <url> <w> <h> <dpr> <out>` to make them again.
