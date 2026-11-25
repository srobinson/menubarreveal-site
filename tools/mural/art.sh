#!/bin/bash
# Paints the wall and encodes the page's four wall pictures into assets/art/. About two minutes.   bash tools/mural/art.sh
#   mural-strip-692.avif, mural-strip-1384.avif       sun at y 300, the middle 692 of the wall's 1440 px: phones
#   mural-sun450-1440.avif, mural-sun450-2880.avif    sun at y 450, the whole wall: wide screens
# paint.py is seeded, so it paints the same wall every time. Needs python3 with numpy, scipy and Pillow, and avifenc.
# The committed files came from libavif 1.4.2 with aom 3.15.3; with those, this script reproduces them byte for byte.
# Another encoder version may give different bytes for the same picture.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ART="$HERE/../../assets/art"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
encode() { avifenc -q 62 -s 4 "$1" "$2" >/dev/null; }

python3 "$HERE/paint.py" --sun-y 300 --flat mural --out "$TMP" </dev/null | tail -1
python3 "$HERE/paint.py" --sun-y 450 --flat mural-sun450 --out "$TMP" </dev/null | tail -1
python3 - "$TMP" <<'PY'
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
tmp = sys.argv[1]
# phones: the centre 1384 of the 2880 px painting, and the centre 692 of it scaled to 1440
wall = Image.open(f'{tmp}/mural.png')
wall.crop((748, 0, 748 + 1384, 3000)).save(f'{tmp}/strip-1384.png')
wall.resize((1440, 1500), Image.LANCZOS).crop((374, 0, 374 + 692, 1500)).save(f'{tmp}/strip-692.png')
# wide screens: the whole painting, and the whole of it scaled to 1440
Image.open(f'{tmp}/mural-sun450.png').resize((1440, 1500), Image.LANCZOS).save(f'{tmp}/sun450-1440.png')
PY
encode "$TMP/strip-692.png" "$ART/mural-strip-692.avif"
encode "$TMP/strip-1384.png" "$ART/mural-strip-1384.avif"
encode "$TMP/sun450-1440.png" "$ART/mural-sun450-1440.avif"
encode "$TMP/mural-sun450.png" "$ART/mural-sun450-2880.avif"
ls -l "$ART"/mural-*.avif
