#!/usr/bin/env python3
"""Written by tm/frontend (claude-fable-5-2).

Seeded painter for the Wheatpaste wall, style: character mural.

Paints one wall as separate layers (ground, field, cast shadows, fills, spray
shading, linework, marks, weathering, later layers, grime, relief), each its
own file, and writes manifest.json and index.html (the CSS composite).

    python3 paint.py                 # 2880 x 3000 layers
    python3 paint.py --scale 0.5     # quick draft into ./draft
    python3 paint.py --sun-y 450 --flat mural-sun450   # the page's art: one flattened PNG, see ../art.sh

The wall is clean by default (owner call, 2026-11-25): the film of paint is whole, and nothing came after
the mural but the tags. --scuffed brings back the flaked paint, the buffed patches and the paste ghosts,
which is the wall as v1 to v10 show it.

All sizes below are CSS px of the 1440 x 1500 wall; S converts to canvas px.
Each layer draws from its own named random streams, so changing one layer
leaves the others pixel identical.
"""
import argparse
import json
import math
import time
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.interpolate import splev, splprep

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
CAST = HERE.parents[5] / 'characters'          # assets/designs/studio/characters

ap = argparse.ArgumentParser()
ap.add_argument('--scale', type=float, default=1.0, help='1 = 2880 x 3000, 0.5 = draft')
ap.add_argument('--seed', type=int, default=1123)
ap.add_argument('--png', action='store_true', help='also write lossless PNG layers')
ap.add_argument('--index', action='store_true', help='only rewrite manifest.json and index.html')
ap.add_argument('--sun-y', type=float, default=300.0, help='the sun\'s centre: 300 for the phone wall, 450 for wide screens')
ap.add_argument('--scuffed', action='store_true', help='the worn wall of v1 to v10: flaked paint, buffed patches, paste ghosts')
ap.add_argument('--flat', metavar='NAME', help='write only NAME.png, the layers flattened as the page shows them (see --off)')
ap.add_argument('--off', default='07', help='layer numbers left out of --flat, comma separated (07: the continuity marks)')
ap.add_argument('--out', type=Path, help='where the files go (default: beside this script, or ./draft for a draft)')
A = ap.parse_args()

S = 2.0 * A.scale
W, H = round(1440 * S), round(1500 * S)
OUT = A.out or (HERE if A.scale == 1.0 else HERE / 'draft')
OUT.mkdir(parents=True, exist_ok=True)
T0 = time.time()


def log(msg):
    print(f'{time.time() - T0:6.1f}s  {msg}', flush=True)


# ---------------------------------------------------------------- helpers
def rng(name):
    return np.random.default_rng([A.seed, zlib.crc32(name.encode())])


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def mix(a, b, t):
    return a + (b - a) * t[..., None]


def q(a, p):
    return float(np.percentile(a[::7, ::7], p))


def uni(a):
    """Rank normalise to 0..1 so thresholds read as area shares."""
    lv = np.linspace(0, 1, 201)
    return np.interp(a, np.quantile(a[::5, ::5], lv), lv).astype(np.float32)


def vnoise(name, cell, octaves=1, gain=0.5, shape=None):
    """Fractal value noise, 0..1. cell is the first octave's feature size in CSS px (or (cy, cx))."""
    h, w = shape or (H, W)
    r = rng(name)
    cy, cx = cell if isinstance(cell, tuple) else (cell, cell)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        sy, sx = max(1.0, cy * S / 2 ** o), max(1.0, cx * S / 2 ** o)
        gh, gw = int(h / sy) + 4, int(w / sx) + 4
        g = r.random((gh, gw), dtype=np.float32)
        if sy <= 1.01 and sx <= 1.01:
            a = g[:h, :w]
        else:
            im = Image.fromarray(g, mode='F').resize((math.ceil(gw * sx), math.ceil(gh * sy)), Image.BICUBIC)
            oy, ox = int(r.integers(0, max(1, int(sy)))), int(r.integers(0, max(1, int(sx))))
            a = np.asarray(im, np.float32)[oy:oy + h, ox:ox + w]
        out += a * amp
        tot += amp
        amp *= gain
    return np.clip(out / tot, 0, 1)


def blur(a, sigma):
    """Gaussian blur, sigma in canvas px; large sigmas run on a reduced copy."""
    if sigma <= 0.05:
        return a
    if sigma < 5:
        return ndi.gaussian_filter(a, sigma, mode='nearest')
    f = int(max(1, sigma // 2.5))
    h, w = a.shape
    small = Image.fromarray(np.ascontiguousarray(a, np.float32), mode='F').resize((max(2, w // f), max(2, h // f)), Image.BOX)
    sm = ndi.gaussian_filter(np.asarray(small, np.float32), sigma / f, mode='nearest')
    return np.asarray(Image.fromarray(sm, mode='F').resize((w, h), Image.BICUBIC), np.float32)


def shifted(a, dy, dx):
    """b[y, x] = a[y - dy, x - dx]; what moves in from outside is 0."""
    dy, dx = int(round(dy)), int(round(dx))
    b = np.zeros_like(a)
    h, w = a.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    b[yd, xd] = a[ys, xs]
    return b


class Layer:
    """One transparent paint layer, straight alpha, painted with plain 'over'."""

    def __init__(self):
        self.rgb = np.zeros((H, W, 3), np.float32)
        self.a = np.zeros((H, W), np.float32)

    def paint(self, m, col, box=None):
        sl = box if box is not None else (slice(None), slice(None))
        m = np.clip(m, 0, 1).astype(np.float32)
        a0 = self.a[sl]
        na = m + a0 * (1 - m)
        col = np.asarray(col, np.float32)
        if col.ndim == 1:
            col = col[None, None, :]
        num = col * m[..., None] + self.rgb[sl] * (a0 * (1 - m))[..., None]
        self.rgb[sl] = num / np.maximum(na, 1e-5)[..., None]
        self.a[sl] = na

    def erase(self, m, box=None):
        sl = box if box is not None else (slice(None), slice(None))
        self.a[sl] *= 1 - np.clip(m, 0, 1)


class Strokes:
    """Brush strokes rasterised with 2x supersampling inside a CSS px box."""

    def __init__(self, box=(0, 0, 1440, 1500)):
        self.x0, self.y0, self.x1, self.y1 = box
        self.k = S * 2
        self.im = Image.new('L', (max(2, round((self.x1 - self.x0) * self.k)), max(2, round((self.y1 - self.y0) * self.k))), 0)
        self.d = ImageDraw.Draw(self.im)

    def line(self, pts, width, taper=(1.0, 1.0), smooth=True, wob=0.0, r=None):
        pts = np.asarray(pts, float)
        seg = np.hypot(*np.diff(pts, axis=0).T)
        n = int(max(6, seg.sum() * self.k / 1.2))
        if smooth and len(pts) > 2:
            tck, _ = splprep(pts.T, s=0, k=min(3, len(pts) - 1))
            pts = np.array(splev(np.linspace(0, 1, n), tck)).T
        else:
            cum = np.concatenate([[0], np.cumsum(seg)])
            tt = np.linspace(0, cum[-1], n)
            pts = np.stack([np.interp(tt, cum, pts[:, 0]), np.interp(tt, cum, pts[:, 1])], 1)
        t = np.linspace(0, 1, len(pts))
        wp = width * (taper[0] + (1 - taper[0]) * sstep(0, .22, t)) * (taper[1] + (1 - taper[1]) * sstep(1, .7, t))
        if wob and r is not None:
            wp = wp * (1 + wob * np.interp(t, np.linspace(0, 1, 9), r.uniform(-1, 1, 9)))
        for (x, y), w in zip(pts, wp):
            rr = max(.35, w / 2 * self.k)
            cx, cy = (x - self.x0) * self.k, (y - self.y0) * self.k
            self.d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=255)

    def dot(self, x, y, rad):
        rr = rad * self.k
        cx, cy = (x - self.x0) * self.k, (y - self.y0) * self.k
        self.d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=255)

    def rrect(self, x, y, w, h, rad):
        k = self.k
        self.d.rounded_rectangle(((x - self.x0) * k, (y - self.y0) * k, (x + w - self.x0) * k, (y + h - self.y0) * k), radius=rad * k, fill=255)

    def mask(self):
        """Full canvas coverage 0..1 and the canvas slices it occupies."""
        x0, y0 = round(self.x0 * S), round(self.y0 * S)
        im = self.im.resize((self.im.width // 2, self.im.height // 2), Image.BOX)
        a = np.asarray(im, np.float32) / 255
        full = np.zeros((H, W), np.float32)
        ys, xs = max(0, y0), max(0, x0)
        ye, xe = min(H, y0 + a.shape[0]), min(W, x0 + a.shape[1])
        full[ys:ye, xs:xe] = a[ys - y0:ye - y0, xs - x0:xe - x0]
        return full


# ---------------------------------------------------------------- palette
NAVY = hexc('#16233a')
PETROL = hexc('#1e6272')
TEAL = hexc('#2c8593')
MUSTARD = hexc('#e3a72a')
SUNLIT = hexc('#edbb47')
OCHRE = hexc('#c98a1c')
CREAM = hexc('#efe3c7')
SALMON = hexc('#e5876d')

FX, FY, SUNR = 720.0, A.sun_y, 330.0   # the sun: behind the main poster (300 on phones; 450 on wide screens, mid first screen at 1440 x 900)
HOR0, HOR1 = 960.0, 1008.0             # the frieze between sky and ground

YY, XX = np.mgrid[0:H, 0:W]
Xc = ((XX + 0.5) / S).astype(np.float32)
Yc = ((YY + 0.5) / S).astype(np.float32)
del YY, XX


# ---------------------------------------------------------------- ground
def build_ground():
    """Bare blockwork with the remains of an old limewash; also the tooth and height maps paint reacts to."""
    r = rng('ground')
    ch, bw, jw = 75.0, 150.0, 3.4
    y = Yc + (vnoise('g.wy', 300, 2) - .5) * 4
    row = np.floor(y / ch).astype(np.int32)
    fy = y - row * ch
    rowoff = r.uniform(-7, 7, row.max() + 4).astype(np.float32)
    x = Xc + (vnoise('g.wx', 300, 2) - .5) * 4 + (row % 2) * (bw / 2) + rowoff[row + 1]
    col = np.floor(x / bw).astype(np.int32)
    fx = x - col * bw
    dj = np.minimum(np.minimum(fy, ch - fy), np.minimum(fx, bw - fx))
    joint = sstep(jw / 2 + .7, jw / 2 - .7, dj + (vnoise('g.jr', 3, 2) - .5) * 1.6)
    bevel = sstep(jw / 2 + 5, jw / 2, dj)
    tb = r.normal(0, 1, (row.max() + 4, col.max() + 4)).astype(np.float32)
    tone = tb[row + 1, col + 1]
    big, mid, fine = vnoise('g.big', 420, 3), vnoise('g.mid', 22, 3), vnoise('g.fine', 1.1, 2)
    pitn = vnoise('g.pit', 2.2, 2) + .16 * (vnoise('g.pitc', 34, 2) - .5)
    pit2 = vnoise('g.pit2', 4.6, 2) + .2 * (vnoise('g.pitd', 60, 2) - .5)
    pits = np.maximum(sstep(q(pitn, 96), q(pitn, 99), pitn), sstep(q(pit2, 98.2), q(pit2, 99.5), pit2))
    v = 1 + .035 * tone + .13 * (big - .5) + .09 * (mid - .5) + .11 * (fine - .5) - .22 * pits
    rgb = np.array([.69, .665, .62], np.float32)[None, None, :] * v[..., None]
    lime = sstep(.5, .6, vnoise('g.lime', 230, 4)) * .6 * (1 - joint)
    rgb = mix(rgb, np.array([.83, .80, .73], np.float32)[None, None, :] * (1 + .08 * (mid - .5))[..., None], lime)
    rgb = mix(rgb, np.array([.60, .58, .545], np.float32)[None, None, :] * (1 + .14 * (fine - .5))[..., None], joint * .92)
    rgb[..., 0] += .02 * (big - .5)
    rgb[..., 2] -= .02 * (big - .5)
    tooth = uni(.45 * fine + .35 * mid + .9 * pits + .9 * joint + .12 * bevel)
    height = -(1.0 * joint + .3 * bevel + .5 * pits) + .3 * (mid - .5) + .17 * (fine - .5)
    return np.clip(rgb, 0, 1), tooth, height, joint


def build_relief(height):
    """Soft light map: 50% grey is flat. Joints, pores and the fall of daylight across the wall."""
    hh = blur(height, .45 * S)
    k = max(1, round(1.1 * S))
    d = hh - np.roll(hh, (k, k), (0, 1))
    rel = .5 + np.clip(d * .5, -.26, .26)
    rel += .045 * (1 - (Xc / 1440 * .7 + Yc / 1500 * 1.1))
    rel -= .07 * sstep(.6, 1.1, np.hypot((Xc - 720) / 900, (Yc - 700) / 1050))
    return np.clip(rel, 0, 1)


# ---------------------------------------------------------------- paint behaviour
def rolltex(name, lane=60.0, ang=0.0, box=None):
    """Tone of a rolled coat: lanes, lap ridges, nap streaks, uneven load."""
    xc, yc = (Xc, Yc) if box is None else (Xc[box], Yc[box])
    r = rng(name)
    a = math.radians(ang)
    u = xc * math.cos(a) + yc * math.sin(a) + (vnoise(name + '.w', 170, 2, shape=xc.shape) - .5) * lane * .55
    li = np.floor(u / lane)
    fr = u / lane - li
    lid = (li - li.min()).astype(np.int32)
    lanes = r.normal(0, 1, lid.max() + 2).astype(np.float32)[lid]
    ridge = np.exp(-(np.minimum(fr, 1 - fr) / .04) ** 2)
    nap = vnoise(name + '.s', (7, 1.3), 2, shape=xc.shape) - .5
    load = vnoise(name + '.b', 140, 3, shape=xc.shape) - .5
    return (1 + .02 * lanes - .018 * ridge + .02 * nap + .06 * load).astype(np.float32)


def coat(name, tooth, cover=.93, box=None, pin=.026):
    """How much of the wall a rolled coat hides: thin passes and pores the nap never reached."""
    t = tooth if box is None else tooth[box]
    thin = (1 - cover) * sstep(.45, .85, vnoise(name + '.t', 110, 3, shape=t.shape))
    holes = sstep(1 - pin, 1 - pin * .35, t)
    return (1 - thin) * (1 - .9 * holes)


def cut(m, name, amp=.34, cell=8.0, soft=.55):
    """A brush cut edge: the clean shape pulled a little off true by the hand and the block face."""
    n = vnoise(name, cell, 2, shape=m.shape) - .5
    return sstep(.5 - .2, .5 + .2, blur(m, soft * S) + n * amp)


# ---------------------------------------------------------------- field: sky, sun, frieze, ground
def build_field(tooth):
    L = Layer()
    r = rng('field')
    ang = np.degrees(np.arctan2(Yc - FY, Xc - FX))
    rad = np.hypot(Xc - FX, Yc - FY)
    wob = (vnoise('f.wob', 12, 2) - .5) * 3.2

    # the coats stop in a ragged roller edge above the pavement
    lane = 62.0
    u = Xc + (vnoise('f.lw', 200, 2) - .5) * 30
    lid = np.floor(u / lane).astype(np.int32) + 2
    ends = r.uniform(-18, 10, lid.max() + 4).astype(np.float32)
    dist = 1447 + ends[lid] + (vnoise('f.eb', (4, 10), 2) - .5) * 9 - Yc
    dry = sstep(30, 0, dist)
    bottom = sstep(0, 1.5, dist) * (1 - sstep(1 - dry * .8, 1.12 - dry * .8, tooth))

    # sky: petrol base, then every other wedge cut in lighter teal
    sky = sstep(HOR0 + 4, HOR0 + 2, Yc)
    L.paint(sky * coat('f.sky', tooth, .95), PETROL[None, None, :] * rolltex('f.sky', 64, 3)[..., None])
    n = 24
    bounds = np.sort(-180 + (np.arange(n) + .5) * 360 / n + r.uniform(-2.4, 2.4, n))
    idx = np.searchsorted(bounds, ang)
    lo = np.where(idx > 0, bounds[np.clip(idx - 1, 0, n - 1)], bounds[-1] - 360)
    hi = np.where(idx < n, bounds[np.clip(idx, 0, n - 1)], bounds[0] + 360)
    dedge = rad * np.sin(np.radians(np.minimum(ang - lo, hi - ang).clip(0, 80)))
    wedge = (idx % 2 == 1) * sstep(-.5, .5, dedge + wob - 1)
    L.paint(wedge * sky * sstep(SUNR - 4, SUNR, rad) * coat('f.teal', tooth, .9), TEAL[None, None, :] * rolltex('f.teal', 52, -8)[..., None])
    del idx, lo, hi

    # ground register: mustard, with a tone on tone dot field growing toward the pavement
    grd = sstep(HOR1 - 4, HOR1 - 2, Yc) * bottom
    L.paint(grd * coat('f.grd', tooth, .93), MUSTARD[None, None, :] * rolltex('f.grd', 60, -2)[..., None])
    sp = 43.0
    uu, vv = (Xc + Yc) / math.sqrt(2), (Xc - Yc) / math.sqrt(2)
    ci, cj = np.floor(uu / sp).astype(np.int32), np.floor(vv / sp).astype(np.int32)
    jit = r.uniform(.8, 1.15, (ci.max() + 2, cj.max() - cj.min() + 2)).astype(np.float32)[ci, cj - cj.min()]
    dd = np.hypot(uu - (ci + .5) * sp, vv - (cj + .5) * sp)
    dots = sstep(.7, -.7, dd - 11.5 * sstep(1004, 1440, Yc) * jit + (vnoise('f.dw', 6, 2) - .5) * 2.4)
    L.paint(dots * grd * coat('f.dots', tooth, .9, pin=.05), OCHRE[None, None, :] * rolltex('f.dots', 30, 20)[..., None])
    del uu, vv, ci, cj, dd, jit

    # the frieze: a navy band between the two registers, a run of hand cut chevrons along it
    band = sstep(HOR0 - 1, HOR0 + 1, Yc + wob * .7) * sstep(HOR1 + 1, HOR1 - 1, Yc + wob * .7)
    L.paint(band * coat('f.band', tooth, .97), NAVY[None, None, :] * rolltex('f.band', 40, 90)[..., None])
    st = Strokes((0, HOR0 - 6, 1440, HOR1 + 6))
    for i in range(29):
        cx = 24 + i * 50.0 + r.uniform(-2.5, 2.5)
        cy = (HOR0 + HOR1) / 2 + r.uniform(-1.6, 1.6)
        a = r.uniform(-.1, .1)
        arm, drop = r.uniform(12.5, 14.5), r.uniform(13, 16)
        ca, sa = math.cos(a), math.sin(a)
        tf = lambda px, py: (cx + px * ca - py * sa, cy + px * sa + py * ca)
        st.line([tf(-arm, -drop / 2), tf(0, drop / 2), tf(arm, -drop / 2)], r.uniform(5.6, 6.8), taper=(.8, .7), smooth=False, wob=.14, r=r)
    chev = st.mask()
    # runs off the band's lower edge
    sd = Strokes((0, HOR1 - 6, 1440, HOR1 + 110))
    for x in r.uniform(20, 1420, 11):
        ln, wd = r.uniform(16, 84), r.uniform(2.2, 3.4)
        sd.line([(x, HOR1 - 3), (x + r.uniform(-.8, .8), HOR1 + ln)], wd, taper=(1, .8), smooth=False)
        sd.dot(x, HOR1 + ln, wd * .72)
    # prerelease: no runs off the band (owner words punk, section 31: drips read as slop)
    L.paint(chev * (1 - .9 * sstep(.86, .95, tooth)), CREAM[None, None, :] * (1 + .08 * (vnoise('f.cv', 5, 2) - .5))[..., None])

    # the sun: a rolled disc with a paler heart, a brushed ring, detached wedge rays (the studio's own sun)
    disc = sstep(-.6, .6, SUNR - rad + wob)
    L.paint(disc * coat('f.sun', tooth, .95), MUSTARD[None, None, :] * rolltex('f.sun', 58, 12)[..., None])
    heart = sstep(-.6, .6, 212 - rad + wob * 1.3)
    L.paint(heart * coat('f.heart', tooth, .88), SUNLIT[None, None, :] * rolltex('f.heart', 58, -30)[..., None])
    ringw = 5.2 * (.75 + .5 * vnoise('f.rw', 60, 2))
    ring = sstep(.6, -.6, np.abs(rad - 354 + wob * .6) - ringw / 2) * (1 - .85 * sstep(.8, .93, tooth))
    L.paint(ring, CREAM)
    nray = 16
    a0 = (ang + 180 + 360 / nray / 2) % (360 / nray) - 360 / nray / 2        # angle to the nearest ray axis
    k = np.floor((ang + 180 + 360 / nray / 2) / (360 / nray)).astype(np.int32) % nray
    half = r.uniform(3.0, 3.9, nray).astype(np.float32)[k]
    r0 = r.uniform(380, 390, nray).astype(np.float32)[k]
    r1 = (np.where(np.arange(nray) % 2 == 0, 560, 486) + r.uniform(-14, 14, nray)).astype(np.float32)[k]
    lat = 8 + (rad - r0) * (half / 19) - np.abs(rad * np.sin(np.radians(a0)))
    rays = sstep(-.6, .6, lat + wob * .5) * sstep(-.6, .6, rad - r0 + wob) * sstep(-.6, .6, r1 - rad + wob)
    L.paint(rays * sky * coat('f.rays', tooth, .92), MUSTARD[None, None, :] * rolltex('f.rays', 26, 40)[..., None])
    del a0, k, half, r0, r1, lat

    # pill clouds, stacked bars of cream
    # sparks: a ring of short cream dashes and dots beyond the rays, one per wedge
    sk = Strokes((0, 0, 1440, 950))
    for i in range(24):
        a = math.radians(-180 + i * 15 + r.uniform(-1.5, 1.5))
        ca, sa = math.cos(a), math.sin(a)
        if i % 2 == 0:
            r0s, r1s = 612 + r.uniform(-6, 6), 650 + r.uniform(-6, 6)
            sk.line([(FX + ca * r0s, FY + sa * r0s), (FX + ca * r1s, FY + sa * r1s)], r.uniform(4.6, 5.8), taper=(.8, .5), smooth=False, wob=.15, r=r)
        else:
            sk.dot(FX + ca * 628 + r.uniform(-2, 2), FY + sa * 628 + r.uniform(-2, 2), r.uniform(3.6, 4.6))
    L.paint(cut(sk.mask(), 'f.sparkc', .3, 5) * sky * (1 - .9 * sstep(.85, .95, tooth)), CREAM)

    clouds, cshadow = np.zeros((H, W), np.float32), np.zeros((H, W), np.float32)
    for (x, y, w, h) in [(34, 86, 232, 46), (104, 136, 262, 46), (1128, 64, 274, 46), (1046, 114, 212, 46)]:
        ccx, ccy = x + w / 2, y + h / 2
        dn = math.hypot(ccx - FX, ccy - FY)
        for dst, ox, oy in ((clouds, 0, 0), (cshadow, 12 * (ccx - FX) / dn, 12 * (ccy - FY) / dn)):
            dx = np.maximum(np.abs(Xc - ccx - ox) - (w / 2 - h / 2), 0)
            np.maximum(dst, sstep(-.6, .6, h / 2 - np.hypot(dx, Yc - ccy - oy) + wob * .5), out=dst)
    L.paint(cshadow * .88, L.rgb * np.array([.55, .64, .76], np.float32)[None, None, :])
    L.paint(clouds * coat('f.cloud', tooth, .9), CREAM[None, None, :] * rolltex('f.cloud', 24, 90)[..., None])
    return L


# ---------------------------------------------------------------- the cast
def cast_shape(slug, pose):
    """Silhouette and small enclosed details of a cast print, cached as a mask (255 ink, 128 detail)."""
    cache = HERE / 'src' / f'{slug}-pose-{pose:02d}-mask.png'
    if cache.exists():
        a = np.asarray(Image.open(cache))
        return a == 255, a == 128
    g = np.asarray(Image.open(CAST / slug / f'pose-{pose:02d}.png').convert('L'), np.float32)
    ink, paper = np.percentile(g, 2), np.median(g)
    m = ndi.gaussian_filter(np.clip((paper - g) / (paper - ink), 0, 1), 1.6) > .5
    lab, n = ndi.label(m)
    ids = np.arange(1, n + 1)
    sizes = ndi.sum(m, lab, ids)
    main = lab == ids[int(np.argmax(sizes))]
    hull = ndi.binary_fill_holes(main)
    inside = ndi.mean(hull, lab, ids)
    keep = np.isin(lab, ids[(inside > .9) & (sizes > 30)])      # the figure and ink islands inside it; props go
    closed = ndi.binary_fill_holes(ndi.binary_closing(keep, iterations=7))
    holes = closed & ~keep
    hl, hn = ndi.label(holes)
    hid = np.arange(1, hn + 1)
    hs = ndi.sum(holes, hl, hid)
    detail = np.isin(hl, hid[(hs > 40) & (hs < .02 * keep.sum())])
    ys, xs = np.where(keep)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = (keep * 255 + detail * 128).astype(np.uint8)[y0:y1, x0:x1]
    cache.parent.mkdir(exist_ok=True)
    Image.fromarray(out).save(cache, optimize=True)
    return out == 255, out == 128


CAST_CFG = [
    dict(key='kern', block='#cf8f1f', slug='04-kern', pose=1, flip=True, h=730, bottom=962, cx=1362, col=MUSTARD, shade='#b4631a', glow='#f6d98a', hole=None),
    dict(key='mull', block='#d06f5a', slug='02-mull', pose=1, flip=True, w=352, bottom=964, right=1338, col=SALMON, shade='#a8463a', glow='#f6c3a8', hole=CREAM),
    dict(key='quoin', block='#d6caa9', slug='01-quoin', pose=1, flip=False, h=506, bottom=964, left=-58, col=CREAM, shade='#9aaaa6', glow='#fffaea', hole=None),
    dict(key='blurt', block='#1f6a78', slug='05-blurt', pose=2, flip=False, h=352, bottom=1437, left=1064, col=TEAL, shade='#144b5a', glow='#7fc4c6', hole=CREAM),
    dict(key='heft', block='#0d1526', slug='03-heft', pose=2, flip=False, h=532, bottom=1438, right=818, col=NAVY, shade='#070b14', glow='#3f6a8c', hole=CREAM),
]


def place_cast(cfg):
    """Scale a cast mask onto the wall; returns canvas slices and the crops (figure, details)."""
    m, det = cast_shape(cfg['slug'], cfg['pose'])
    if cfg['flip']:
        m, det = m[:, ::-1], det[:, ::-1]
    k = cfg['h'] * S / m.shape[0] if 'h' in cfg else cfg['w'] * S / m.shape[1]
    tw, th = round(m.shape[1] * k), round(m.shape[0] * k)
    left = cfg['left'] * S if 'left' in cfg else (cfg['right'] * S - tw if 'right' in cfg else cfg['cx'] * S - tw / 2)
    left, top = round(left), round(cfg['bottom'] * S - th)
    pad = round(70 * S)
    y0, y1, x0, x1 = max(0, top - pad), min(H, top + th + pad), max(0, left - pad), min(W, left + tw + pad)
    crops = []
    for src in (m, det):
        im = np.asarray(Image.fromarray((src * 255).astype(np.uint8)).resize((tw, th), Image.LANCZOS), np.float32) / 255
        c = np.zeros((y1 - y0, x1 - x0), np.float32)
        ys, xs = max(top, y0), max(left, x0)
        ye, xe = min(top + th, y1), min(left + tw, x1)
        c[ys - y0:ye - y0, xs - x0:xe - x0] = im[ys - top:ye - top, xs - left:xe - left]
        crops.append(c)
    box = (slice(y0, y1), slice(x0, x1))
    cyx = ndi.center_of_mass(crops[0])
    cx, cy = (x0 + cyx[1]) / S, (y0 + cyx[0]) / S
    d = np.array([cx - FX, cy - FY])
    d /= np.hypot(*d)                                   # the way the sun's light travels across this figure
    log(f"  {cfg['key']}: {tw / S:.0f} x {th / S:.0f} at ({left / S:.0f}, {top / S:.0f}), light {d.round(2)}")
    return box, crops[0], crops[1], d


def build_cast(tooth, field):
    shadow, fills, shading, lines = Layer(), Layer(), Layer(), Layer()
    protect = np.zeros((H, W), np.float32)
    # the sun throws a sprayed halo past its ring, so the middle of the wall reads as the light
    rad = np.hypot(Xc - FX, Yc - FY)
    halo = np.where(rad > 374, np.exp(-((rad - 374) / 74) ** 2), sstep(358, 374, rad)) * sstep(HOR0 - 2, HOR0 - 60, Yc)
    hr = rng('cast.halo').random((H, W), dtype=np.float32)
    halo = (.72 * halo + .28 * blur((halo > hr).astype(np.float32), .5 * S)) * field.a
    shadow.paint(halo * .36, hexc('#f6dfa0'))
    del rad, hr, halo
    for cfg in CAST_CFG:
        key = cfg['key']
        box, m0, det0, d = place_cast(cfg)
        r = rng('cast.' + key)
        tb = tooth[box]
        m = cut(m0, f'c.{key}.cut', .3, 9)
        det = cut(det0, f'c.{key}.dcut', .25, 6)

        # cast shadow: a flat darker glaze of whatever is behind, thrown away from the sun
        off = 17
        sh = shifted(m, d[1] * off * S, d[0] * off * S)
        under = field.rgb[box] * np.array([.52, .60, .72], np.float32)[None, None, :] * rolltex(f'c.{key}.sh', 34, 20, box)[..., None]
        shadow.paint(sh * field.a[box] * coat(f'c.{key}.shc', tooth, .9, box) * .9, under, box)

        # a figure in front hides the spray and line of the one behind
        shading.erase(m, box)
        lines.erase(m, box)
        ys = np.where(m0.max(1) > .5)[0]
        rel = (np.arange(m.shape[0], dtype=np.float32)[:, None] - ys.min()) / max(1, ys.max() - ys.min())
        protect[box] = np.maximum(protect[box], m * (.35 + .65 * sstep(.5, .25, rel)))   # weather spares heads and hands

        # flat fill, two coats by small roller, edges cut in by brush
        fills.paint(m * coat(f'c.{key}.f', tooth, .96, box, pin=.02), cfg['col'][None, None, :] * rolltex(f'c.{key}.f', 30, r.uniform(-12, 12), box)[..., None], box)
        xc, yc = Xc[box], Yc[box]
        wsum = m.sum()
        proj = (xc - (xc * m).sum() / wsum) * d[0] + (yc - (yc * m).sum() / wsum) * d[1]      # CSS px along the light
        far = float(np.percentile(proj[m > .5], 98))
        term = proj - .3 * far + (vnoise(f'c.{key}.bw', 90, 2, shape=m.shape) - .5) * 14
        block = cut(m * sstep(-1, 1, term), f'c.{key}.bcut', .3, 9)
        fills.paint(block * coat(f'c.{key}.b', tooth, .95, box, pin=.02), hexc(cfg['block'])[None, None, :] * rolltex(f'c.{key}.b', 30, r.uniform(-12, 12), box)[..., None], box)
        if cfg['hole'] is not None:
            fills.paint(det * coat(f'c.{key}.d', tooth, .97, box, pin=.015), cfg['hole'], box)
        # runs, where the roller left more than the wall would hold
        dim = Image.new('L', (m.shape[1], m.shape[0]), 0)
        dd = ImageDraw.Draw(dim)
        cols = np.where(m0[:-2].max(0) > .5)[0]
        for _ in range(int(r.integers(3, 6))):
            cxp = int(r.choice(cols))
            yb = int(np.where(m0[:, cxp] > .5)[0].max())
            if yb > m.shape[0] - 4:
                continue
            ln, wd = r.uniform(12, 56) * S, r.uniform(1.8, 2.8) * S
            dd.line([(cxp, yb - 2 * S), (cxp + r.uniform(-1, 1), yb + ln)], fill=255, width=max(1, round(wd)))
            dd.ellipse((cxp - wd * .72, yb + ln - wd * .72, cxp + wd * .72, yb + ln + wd * .72), fill=255)
        runs = blur(np.asarray(dim, np.float32) / 255, .35 * S)
        # prerelease: no runs under the figures (same note); the strokes above still draw from the stream

        # spray: a fade inside the far edge, a glow inside the edge that faces the sun
        def inner(k, sig, sign=1):
            return m * (1 - blur(shifted(m, -sign * d[1] * k * S, -sign * d[0] * k * S), sig * S))
        fade = np.clip(.62 * inner(26, 13) + .5 * inner(64, 30), 0, 1)
        grain = r.random(m.shape, dtype=np.float32)
        fade = .78 * fade + .22 * blur((fade > grain * .9).astype(np.float32), .5 * S)
        shading.paint(fade * .42 * (1 - .5 * sstep(.9, .98, tb)), hexc(cfg['shade']), box)
        glow = np.clip(inner(13, 7, -1), 0, 1)
        glow = .7 * glow + .3 * blur((glow > r.random(m.shape, dtype=np.float32)).astype(np.float32), .5 * S)
        shading.paint(glow * .2, hexc(cfg['glow']), box)
        # overspray drifting past the far edge
        mist = blur(shifted(m, d[1] * 9 * S, d[0] * 9 * S), 9 * S) * (1 - m) * (1 - sh * .6)
        mist = (mist * .55 > r.random(m.shape, dtype=np.float32) ** 1.6).astype(np.float32)
        shading.paint(blur(mist, .45 * S) * .5, hexc(cfg['shade']), box)

        # brush line: heavy on the far side, gone on the lit side, a hair off register
        mb = m > .5
        sdf = (ndi.distance_transform_edt(mb) - ndi.distance_transform_edt(~mb)) / S
        g = blur(m, 5 * S)
        gy, gx = np.gradient(g)
        wgt = -(gx * d[0] + gy * d[1]) / (np.hypot(gx, gy) + 1e-6)
        openness = sstep(.3, .46, blur(1 - m, 14 * S))
        th = 7.0 * sstep(-.2, .7, wgt) * (.62 + .76 * vnoise(f'c.{key}.lw', 60, 2, shape=m.shape)) * openness
        line = sstep(.6, -.6, np.abs(sdf + th * .12) - th * .5) * (th > .9)
        line = shifted(line, 1.3 * S, 1.0 * S) * (1 - .92 * sstep(.82, .93, tb))
        lcol = NAVY if key != 'heft' else hexc('#0a0f1c')
        lines.paint(line, lcol[None, None, :] * (1 + .25 * (vnoise(f'c.{key}.lt', 4, 2, shape=m.shape) - .5))[..., None], box)
        # the sign painter's shine: a broken light line just inside the lit edge
        if key != 'quoin':
            gate = sstep(.5, .56, vnoise(f'c.{key}.hg', 52, 2, shape=m.shape))
            shine = sstep(.6, -.6, np.abs(sdf - 12) - 1.4) * sstep(.55, .88, -wgt) * gate
            lines.paint(shine * .6 * (1 - .9 * sstep(.84, .94, tb)), hexc(cfg['glow']), box)
    return shadow, fills, shading, lines, protect


# ---------------------------------------------------------------- accents and marks
def build_accents(lines, tooth):
    """Loose brush accents added to the linework layer: the ground under the feet, flicks round the hand."""
    r = rng('accents')
    st = Strokes()
    # blurt's shout: three widening dashes toward the left
    for i, a in enumerate((-158, -176, -196)):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        st.line([(1064 + ca * 26, 1150 + sa * 26), (1064 + ca * (64 + i * 4), 1150 + sa * (64 + i * 4))], 6, taper=(.9, .3), smooth=False, wob=.15, r=r)
    m = st.mask()
    lines.paint(m * (1 - .9 * sstep(.84, .94, tooth)), NAVY)
    # three glints on the sun's ring, clear of the main poster: the thing in the middle is a jewel
    sg = Strokes((300, FY - 200, 1140, FY + 300))
    for ang, size in ((197, 30), (-13, 22), (33, 16)):
        gx, gy = FX + 354 * math.cos(math.radians(ang)), FY + 354 * math.sin(math.radians(ang))
        rot = r.uniform(-.2, .2)
        for j, ln in enumerate((size, size * .62)):
            a = rot + j * math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            for sgn in (-1, 1):
                sg.line([(gx, gy), (gx + sgn * ca * ln, gy + sgn * sa * ln)], size * .26, taper=(1, .08), smooth=False)
    lines.paint(sg.mask() * (1 - .8 * sstep(.88, .96, tooth)), hexc('#fff8e6'))


DIGITS = {  # hand lettered counts: one brush stroke each on a 10 x 16 box
    '1': [[(3, 4), (6, 1), (6, 15)]],
    '2': [[(1.5, 4), (3, 1.8), (5.5, 1), (8, 2.2), (8.5, 5), (2, 15), (9, 15)]],
    '3': [[(1.5, 2.5), (5, 1), (8, 3), (4.5, 7.5), (8, 9.5), (8.5, 12.5), (5.5, 15), (1.5, 13.5)]],
    '4': [[(7, 15), (7, 1), (1, 11), (9.5, 11)]],
    '7': [[(1.5, 1.5), (9, 1.5), (4, 15)]],
    '9': [[(8.5, 5), (7, 1.8), (4.5, 1), (2, 2.5), (1.5, 5.5), (3.5, 8), (6.5, 8), (8.5, 5), (8.2, 10), (7, 15)]],
}


def build_marks(tooth):
    """The quiet continuity marks, painted in as small details: a row of numbered chips, a window face."""
    L = Layer()
    r = rng('marks')
    # chips: five rolled squares in navy with brushed counts under them, on the mustard near the pavement
    st, sn = Strokes((730, 1330, 940, 1440)), Strokes((730, 1330, 940, 1440))
    x0, y0, sz, gap = 744.0, 1360.0, 24.0, 9.0
    for i, cnt in enumerate(('12', '4', '27', '9', '3')):
        x = x0 + i * (sz + gap)
        st.rrect(x + r.uniform(-1, 1), y0 + r.uniform(-1.5, 1.5), sz, sz, 5.5)
        tw = len(cnt) * 9.4
        for j, ch in enumerate(cnt):
            ox, oy = x + sz / 2 - tw / 2 + j * 9.4 + r.uniform(-.5, .5), y0 + sz + 9 + r.uniform(-.8, .8)
            for stroke in DIGITS[ch]:
                sn.line([(ox + px * .88, oy + py * .9) for px, py in stroke], 2.4, taper=(.85, .8), smooth=False, wob=.1, r=r)
    chips = cut(st.mask(), 'mk.chip', .3, 5)
    L.paint(chips * (1 - .3 * sstep(.9, .97, tooth)), NAVY[None, None, :] * rolltex('mk.chip', 12, 0)[..., None])
    L.paint(sn.mask() * (1 - .25 * sstep(.9, .97, tooth)), NAVY)

    # window faces: a rounded pane with two eyes and a smile, one brush line
    for (cx, cy, sz, rot, col) in [(398, 736, 34, -.12, CREAM), (1392, 1392, 30, .1, NAVY)]:
        sw = Strokes((cx - sz, cy - sz, cx + sz, cy + sz))
        hw, rr = sz / 2, sz * .26
        pts = []
        for (ax, ay, a0) in [(hw - rr, -hw + rr, -90), (hw - rr, hw - rr, 0), (-hw + rr, hw - rr, 90), (-hw + rr, -hw + rr, 180)]:
            for t in np.linspace(0, 90, 6):
                a = math.radians(a0 + t)
                pts.append((ax + rr * math.cos(a), ay + rr * math.sin(a)))
        pts.append(pts[0])
        pts.append(pts[1])
        cr, sr = math.cos(rot), math.sin(rot)
        tf = lambda p: (cx + p[0] * cr - p[1] * sr + r.uniform(-.4, .4), cy + p[0] * sr + p[1] * cr + r.uniform(-.4, .4))
        sw.line([tf(p) for p in pts], sz * .085, taper=(.8, .6), smooth=True, wob=.12, r=r)
        sw.line([tf((-hw * .36, -hw * .28)), tf((-hw * .36, -hw * .02))], sz * .09, smooth=False)
        sw.line([tf((hw * .36, -hw * .28)), tf((hw * .36, -hw * .02))], sz * .09, smooth=False)
        sw.line([tf((-hw * .42, hw * .28)), tf((0, hw * .5)), tf((hw * .42, hw * .28))], sz * .08, taper=(.6, .6), smooth=True)
        L.paint(sw.mask() * (1 - .85 * sstep(.86, .95, tooth)), col)
    return L


# ---------------------------------------------------------------- weathering
def build_weather(ground, tooth, joint, cover, protect, keep):
    """The chalky fade where the sun has had the wall longest and, on the scuffed wall only, flaked paint (primer first, then block)."""
    L = Layer()
    n = vnoise('w.chip', 150, 5, .56)
    hot = .05 * blur(joint, 2 * S) + .09 * sstep(1230, 1470, Yc)
    for (x, y, rr, amp) in [(1410, 30, 170, .10), (50, 1410, 200, .10), (1436, 600, 110, .07), (8, 300, 100, .07), (1010, 20, 110, .05), (1400, 1250, 120, .06)]:
        hot += amp * np.exp(-((Xc - x) ** 2 + (Yc - y) ** 2) / (2 * rr * rr))
    v = n + hot + (vnoise('w.crisp', 6, 3) - .5) * .11 - .16 * blur(protect, 12 * S)
    th = q(n, 97.2)
    flake = cover * keep if A.scuffed else 0.0                # keep: no flake may touch the continuity marks
    primer = sstep(th, th + .006, v) * flake
    bare = sstep(th + .03, th + .036, v) * flake
    L.paint(primer, hexc('#d8d2c4')[None, None, :] * (1 + .1 * (vnoise('w.pr', 9, 3) - .5))[..., None])
    L.paint(bare, ground * .96)
    k = max(1, round(.9 * S))
    hole = np.maximum(primer, bare * 0)
    lip = hole * (1 - shifted(hole, k, k))                   # the paint film's edge shades the top left of each flake
    L.paint(lip * .5, hexc('#3a352e'))
    lit = (1 - hole) * shifted(hole, k, k) * cover           # and catches light along the bottom right
    L.paint(lit * .35, hexc('#fff6e0'))
    # chalking
    fade = cover * (1 - hole) * (.04 + .15 * sstep(.38, .82, vnoise('w.fade', 360, 3))) * (.55 + .9 * vnoise('w.fst', (520, 26), 2))
    L.paint(fade, hexc('#ece6d8'))
    return L


def build_grime():
    """Multiply map (white is clean): rain tracks from the coping, splash back, rust runs, general soot."""
    reach = 220 + 1100 * vnoise('gr.len', (6000, 22), 1)
    g = .27 * sstep(.56, .9, vnoise('gr.st', (900, 17), 3)) * (1 - sstep(reach * .45, reach, Yc))
    g += .5 * sstep(1330, 1500, Yc) * (.45 + .8 * vnoise('gr.bot', 46, 3))
    g += .2 * sstep(.52, .9, vnoise('gr.blot', 280, 4))
    g += .16 * sstep(0, 46, 46 - Yc) + .1 * sstep(.6, .9, vnoise('gr.fine', 14, 3))
    dirt = hexc('#5d5548')
    rgb = 1 - np.clip(g, 0, .85)[..., None] * (1 - dirt)[None, None, :]
    rust = hexc('#b0683a')
    # the first fixing bled down the left clouds; on the clean wall it is on plain sky beside them
    first = (214, 122) if A.scuffed else (392, 58)
    for (x, y, ln, wd) in [(*first, 250, 7), (1268, 408, 190, 6), (642, 1046, 240, 8), (1104, 12, 330, 9)]:
        dy = Yc - y
        run = np.exp(-((Xc - x + (vnoise(f'gr.r{x}', (90, 5), 2) - .5) * 7) ** 2) / (2 * (wd * (.5 + dy.clip(0) / ln)) ** 2)) * np.exp(-dy.clip(0) / (ln * .45)) * (dy > -2)
        rgb *= 1 - (run * .62)[..., None] * (1 - rust)[None, None, :]
        rgb *= 1 - sstep(4.2, 3.2, np.hypot(Xc - x, dy))[..., None] * .75
    return np.clip(rgb, 0, 1)


# ---------------------------------------------------------------- later layers
def scribble(r, x, y, w, h, n):
    """A run of tall loops along a rising baseline: reads as a tag, spells nothing."""
    pts = []
    for i in range(n):
        t = i / (n - 1)
        px = x + w * t + r.uniform(-.05, .05) * w
        top = i % 2 == 0
        py = y + (0 if top else h) + r.uniform(-.2, .2) * h - t * h * .22
        pts.append((px, py))
        if r.random() < .5:
            pts.append((px + r.uniform(.03, .09) * w, py + (.55 if top else -.55) * h * r.uniform(.6, 1)))
            pts.append((px - r.uniform(.0, .05) * w, py + (.3 if top else -.3) * h))
    return pts


def build_later(tooth, ground):
    """What came after the mural: a few abstract tags and, on the scuffed wall only, buffed patches and the ghosts of torn down posters."""
    L = Layer()
    r = rng('later')
    # buff: rolled rectangles in a paint that nearly matched once
    for i, (x, y, w, h, col, lane) in enumerate([(-10, 1012, 132, 300, '#b3ab9b', 44), (-10, -10, 196, 150, '#4c7884', 50), (1196, 1010, 260, 96, '#b9b1a0', 46)]):
        u = Xc + (vnoise(f'l.b{i}w', 120, 2) - .5) * 16
        lid = np.floor(u / lane).astype(np.int32) + 2
        e = r.uniform(-14, 14, (2, lid.max() + 4)).astype(np.float32)
        if not A.scuffed:                                     # drawn from all the same, so the tags stay the tags they were
            continue
        m = sstep(-1, 1, Xc - x) * sstep(-1, 1, x + w - Xc) * sstep(-1, 1, Yc - (y + e[0][lid])) * sstep(-1, 1, y + h + e[1][lid] - Yc)
        m = cut(m, f'l.b{i}c', .5, 10, 1.2)
        L.paint(m * coat(f'l.b{i}', tooth, .8, pin=.05), hexc(col)[None, None, :] * rolltex(f'l.b{i}', lane, 0)[..., None])
    # paste ghosts: glue haze brushed in diagonals and scraps of paper that would not come off
    for i, (x, y, w, h, rot) in enumerate([(1136, 190, 150, 210, .035), (36, 214, 150, 216, -.03), (858, 1046, 158, 226, .02)] if A.scuffed else []):
        cx, cy = x + w / 2, y + h / 2
        xr = (Xc - cx) * math.cos(rot) + (Yc - cy) * math.sin(rot)
        yr = -(Xc - cx) * math.sin(rot) + (Yc - cy) * math.cos(rot)
        inside = np.minimum(w / 2 - np.abs(xr), h / 2 - np.abs(yr))
        rect = sstep(-1.5, 1.5, inside + (vnoise(f'l.g{i}e', 16, 2) - .5) * 8)
        haze = rect * (.02 + .1 * sstep(.45, .8, vnoise(f'l.g{i}h', (46, 6), 2))) * (.4 + .6 * sstep(26, 0, inside))
        L.paint(haze, hexc('#e9e1cf'))
        sn = vnoise(f'l.g{i}s', 26, 4, .6) + .2 * sstep(30, 2, inside) + .12 * sstep(-h * .2, -h / 2, yr)
        scrap = rect * sstep(q(sn, 90.5), q(sn, 90.5) + .012, sn + (vnoise(f'l.g{i}f', 3, 2) - .5) * .05)
        k = max(1, round(.8 * S))
        L.paint(shifted(scrap, k, k) * .35 * (1 - scrap), hexc('#2b2620'))
        L.paint(scrap, hexc('#e6dfcd')[None, None, :] * (1 + .12 * (vnoise(f'l.g{i}t', 12, 3) - .5) - .1 * sstep(.6, .9, vnoise(f'l.g{i}d', 50, 2)))[..., None])
    # tags: fat cap scribbles with a soft edge, overspray and the odd run
    # the white one stood on the buffed patch in the top left corner; with the patch gone it would sit on the clouds, so on the clean wall it is lower
    white = (26, 34) if A.scuffed else (30, 216)
    for i, (x, y, w, h, n, wd, col, a) in enumerate([(8, 1096, 104, 64, 6, 6.5, '#101014', .94), (*white, 150, 62, 7, 6.0, '#e9e6de', .9), (1210, 1026, 220, 54, 8, 6.5, '#c4447c', .92), (1150, 1456, 240, 30, 9, 4.2, '#d9d6cf', .85)]):
        st = Strokes((x - 40, y - 60, x + w + 60, y + h + 150))
        pts = scribble(r, x, y, w, h, n)
        st.line(pts, wd, taper=(.7, .55), smooth=True, wob=.22, r=r)
        st.line([(x - 4, y + h + 12), (x + w * .5, y + h + 6 + r.uniform(-4, 4)), (x + w + 12, y + h + 14)], wd * .9, taper=(.6, .4), smooth=True, wob=.2, r=r)
        ex, ey = x + w + 16, y + h * .1
        for j in range(2):
            st.line([(ex + j * wd * 1.7, ey), (ex + j * wd * 1.7 - wd * .5, ey + wd * 2.2)], wd * .8, taper=(1, .5), smooth=False)
        for _ in range(int(r.integers(2, 5))):                # runs, where the can lingered
            px, py = pts[int(r.integers(0, len(pts)))]
            ln = r.uniform(18, 70)
            st.line([(px, py), (px + r.uniform(-.6, .6), py + ln)], wd * .34, taper=(1, .8), smooth=False)
            st.dot(px, py + ln, wd * .26)
        m = st.mask()
        soft = blur(m, .7 * S)
        halo = blur(m, 5 * S)
        spk = (halo * .5 > r.random((H, W), dtype=np.float32) ** 1.5).astype(np.float32) * (1 - soft)
        L.paint(np.clip(soft * 1.15, 0, 1) * a * (1 - .5 * sstep(.92, .99, tooth)) + blur(spk, .4 * S) * .5, hexc(col))
    return L


# ---------------------------------------------------------------- output
def save(name, rgb, a=None):
    arr = (np.clip(rgb, 0, 1) * 255 + .5).astype(np.uint8)
    if a is None:
        im = Image.fromarray(arr, 'RGB')
    else:
        im = Image.fromarray(np.dstack([arr, (np.clip(a, 0, 1) * 255 + .5).astype(np.uint8)]), 'RGBA')
    im.save(OUT / f'{name}.webp', 'WEBP', quality=82, method=4, alpha_quality=90)
    if A.png:
        im.save(OUT / f'{name}.png', compress_level=6)
    log(f'wrote {name}.webp {(OUT / (name + ".webp")).stat().st_size // 1024} KiB')


def soft_light(d, s):
    s = s[..., None]
    dd = np.where(d <= .25, ((16 * d - 12) * d + 4) * d, np.sqrt(d))
    return np.where(s <= .5, d - (1 - 2 * s) * d * (1 - d), d + (2 * s - 1) * (dd - d))


MANIFEST = [
    ('01-ground', 'ground', 'normal', 'Bare blockwork with the remains of an old limewash. Opaque.'),
    ('02-field', 'fills', 'normal', 'The rolled background: petrol and teal sky rays, the sun, pill clouds, the chevron frieze, the mustard ground with its dot field.'),
    ('03-shadow', 'shading', 'normal', 'Under the figures: the sun\'s sprayed halo and the flat cast shadows thrown away from it.'),
    ('04-fills', 'fills', 'normal', 'The cast as flat rolled fills, each with a second tone on its far side: Quoin cream, Mull salmon, Kern mustard, Heft navy, Blurt teal.'),
    ('05-shading', 'shading', 'normal', 'Spray: a fade inside each figure\'s far edge, a glow on the edge that faces the sun, overspray.'),
    ('06-linework', 'linework', 'normal', 'Navy brush line on the far side of each figure, plus a few loose accents.'),
    ('07-marks', 'linework', 'normal', 'Continuity marks painted into the mural: the row of five numbered chips, two window faces.'),
    ('08-weathering', 'weathering', 'normal', 'Flaked paint showing primer then block, and the chalky sun fade.'),
    ('09-later', 'weathering', 'normal', 'What came after: buffed patches, ghosts of torn down posters, abstract tags.'),
    ('10-grime', 'weathering', 'multiply', 'Rain tracks, splash back, rust runs, soot. Opaque; white is clean.'),
    ('11-relief', 'weathering', 'soft-light', 'Block joints, pores and daylight. Opaque; 50% grey is flat. May also sit above the posters so paper sinks into the joints.'),
]


INDEX = """<!doctype html>
<!-- Written by tm/frontend (claude-fable-5-2). Generated by paint.py from its layer list; do not edit by hand. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wall: character mural, layers</title>
<style>
html,body{margin:0;background:#1b1a18}
/* The wall: every layer is its own file, stacked in order and blended in CSS.
   2880 x 3000 art for a 1440 x 1500 wall, anchored top centre, cover on any width. */
.wall{position:relative;isolation:isolate;overflow:hidden;min-height:1500px}
.wall i{position:absolute;inset:0;background:top center/cover no-repeat}
.wall i[hidden]{display:none}
.sheet{position:absolute;left:50%;top:0;width:min(520px,92vw);height:900px;translate:-50% 0;background:#ece4d2;box-shadow:0 10px 24px rgb(0 0 0/.34),0 1px 2px rgb(0 0 0/.4);rotate:-.6deg}
.sheet[hidden]{display:none}
.tools{position:fixed;right:16px;bottom:16px;font:13px/1.3 ui-sans-serif,system-ui,sans-serif;color:#efe9db;background:rgb(24 22 20/.9);border-radius:6px;padding:8px 12px;max-width:260px}
.tools summary{cursor:pointer;font-weight:600}
.tools label{display:flex;gap:8px;align-items:baseline;padding:4px 0}
.tools small{color:#b9b2a2}
.clean .tools{display:none}
</style>
</head>
<body>
<main class="wall" aria-label="Painted wall: character mural">
%(layers)s
  <div class="sheet" id="sheet" hidden></div>
</main>
<details class="tools">
  <summary>Layers</summary>
%(toggles)s
  <label><input type="checkbox" data-for="sheet"> <span>main poster footprint <small>520 x 900</small></span></label>
</details>
<script>
// ?clean hides the panel; ?poster shows the main poster's footprint; ?off=03,05 hides layers by number
const q = new URLSearchParams(location.search);
if (q.has('clean')) document.documentElement.classList.add('clean');
const off = (q.get('off') || '').split(',').filter(Boolean);
for (const box of document.querySelectorAll('.tools input')) {
  const el = document.getElementById(box.dataset.for);
  if (el.id === 'sheet') box.checked = q.has('poster'); else box.checked = !off.some((n) => el.id.startsWith('l' + n));
  const sync = () => { el.hidden = !box.checked; };
  box.addEventListener('change', sync);
  sync();
}
</script>
</body>
</html>
"""


def write_index():
    manifest = [dict(file=f'{n}.webp', role=role, blend=blend, order=i, note=note) for i, (n, role, blend, note) in enumerate(MANIFEST)]
    (HERE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    layers = '\n'.join(f'  <i id="l{n}" style="background-image:url({n}.webp)' + ('' if blend == 'normal' else f';mix-blend-mode:{blend}') + '"></i>' for n, role, blend, note in MANIFEST)
    toggles = '\n'.join(f'  <label><input type="checkbox" data-for="l{n}" checked> <span>{n[3:]} <small>{role}' + ('' if blend == 'normal' else f', {blend}') + '</small></span></label>' for n, role, blend, note in MANIFEST)
    (HERE / 'index.html').write_text(INDEX.replace('%(layers)s', layers).replace('%(toggles)s', toggles))
    log('wrote manifest.json and index.html')


def main():
    if A.index:
        return write_index()
    log(f'canvas {W} x {H}, seed {A.seed}')
    ground, tooth, height, joint = build_ground()
    log('ground')
    relief = build_relief(height)
    del height
    field = build_field(tooth)
    log('field')
    shadow, fills, shading, lines, protect = build_cast(tooth, field)
    build_accents(lines, tooth)
    log('cast')
    marks = build_marks(tooth)
    log('marks')
    cover = np.clip(field.a + fills.a, 0, 1)
    protect = np.maximum(protect, np.clip(blur(marks.a, 12 * S) * 8, 0, 2.2))
    weather = build_weather(ground, tooth, joint, cover, protect, 1 - np.clip(blur(marks.a, 9 * S) * 7, 0, 1))
    log('weathering')
    later = build_later(tooth, ground)
    log('later')
    grime = build_grime()
    log('grime')

    flat = ground.copy()
    stack = {'01-ground': (ground, None), '02-field': field, '03-shadow': shadow, '04-fills': fills, '05-shading': shading,
             '06-linework': lines, '07-marks': marks, '08-weathering': weather, '09-later': later,
             '10-grime': (grime, None), '11-relief': (np.repeat(relief[..., None], 3, 2), None)}
    off = tuple(n for n in A.off.split(',') if n) if A.flat else ()
    for name, role, blend, note in MANIFEST:
        if off and name.startswith(off):
            continue
        lay = stack[name]
        rgb, a = (lay.rgb, lay.a) if isinstance(lay, Layer) else lay
        if not A.flat:
            save(name, rgb, a)
        if blend == 'multiply':
            flat *= rgb
        elif blend == 'soft-light':
            flat = soft_light(flat, rgb[..., 0])
        elif a is not None:
            flat += (rgb - flat) * a[..., None]
    if A.flat or A.scale != 1.0:      # the page's art, or a draft's check image; the layered composite is index.html
        Image.fromarray((np.clip(flat, 0, 1) * 255 + .5).astype(np.uint8)).save(OUT / f'{A.flat or "flat-check"}.png', compress_level=3)
        log(f'wrote {A.flat or "flat-check"}.png')
    elif A.scale == 1.0:
        write_index()
    log('done')


main()
