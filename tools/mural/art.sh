#!/bin/bash
# Paints the wall and leaves its two lossless masters in tools/mural/masters/ (not committed). About two minutes.
#   bash tools/mural/art.sh && npm run art
#   mural-strip-1384.png     sun at y 300, the middle 1384 of the painting's 2880 px: phones
#   mural-sun450-2880.png    sun at y 450, the whole painting: wide screens
# `npm run art` then encodes the page's four wall pictures from them (tools/art.mjs holds the widths and the quality),
# names each for its bytes and writes the names and previews into the page.
# paint.py is seeded, so it paints the same wall every time. Needs python3 with numpy, scipy and Pillow.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/masters"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

python3 "$HERE/paint.py" --sun-y 300 --flat mural --out "$TMP" </dev/null | tail -1
python3 "$HERE/paint.py" --sun-y 450 --flat mural-sun450 --out "$OUT" </dev/null | tail -1
mv "$OUT/mural-sun450.png" "$OUT/mural-sun450-2880.png"
python3 - "$TMP" "$OUT" <<'PY'
import sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
tmp, out = sys.argv[1], sys.argv[2]
# phones: the centre 1384 of the 2880 px painting
Image.open(f'{tmp}/mural.png').crop((748, 0, 748 + 1384, 3000)).save(f'{out}/mural-strip-1384.png')
PY
ls -l "$OUT"
