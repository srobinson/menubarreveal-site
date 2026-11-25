#!/bin/bash
# Pixel parity with the frozen v13 design: bash measurements/parity.sh <new site url> [v13 url]
# Full page screenshots of both at 1858x1033 and 1440x900 (1x) and 390x844 (2x) with agent-browser, then a pixel by
# pixel comparison. Writes measurements/parity/<size>-v13.png, <size>-new.png and <size>-diff.png (differing pixels in red
# over a dimmed copy of the new page) and prints, for each size, how many pixels differ and by how much at most.
set -u
NEW="$1"; OLD="${2:-http://127.0.0.1:8780/punk/ideas/wheatpaste/prerelease/v13/index.html}"
OUT="$(cd "$(dirname "$0")" && pwd)/parity"; mkdir -p "$OUT"
ab() { agent-browser --session mbr-parity --args "--mute-audio" "$@" </dev/null >/dev/null 2>&1; }
for size in "1858 1033 1" "1440 900 1" "390 844 2"; do
  set -- $size
  for which in v13 new; do
    url="$OLD"; [ "$which" = new ] && url="$NEW"
    ab set viewport "$1" "$2" "$3"; ab open "$url"; ab wait 1500
    ab scroll down 30000; ab wait 500; ab scroll up 30000; ab wait 500
    ab screenshot --full "$OUT/$1x$2-$which.png"
  done
  python3 -I - "$OUT/$1x$2" <<'PY'
import sys
from PIL import Image, ImageChops, ImageEnhance
base = sys.argv[1]
a = Image.open(base + '-v13.png').convert('RGB'); b = Image.open(base + '-new.png').convert('RGB')
if a.size != b.size:
    print(base.split('/')[-1], 'SIZES DIFFER', a.size, b.size); sys.exit()
diff = ImageChops.difference(a, b)
mask = diff.convert('L').point(lambda v: 255 if v else 0)
count = sum(1 for v in mask.getdata() if v)
out = ImageEnhance.Brightness(b).enhance(.35); out.paste((255, 0, 0), mask=mask); out.save(base + '-diff.png')
print(base.split('/')[-1], a.size, 'differing pixels:', count, 'of', a.size[0] * a.size[1], '| largest channel difference:', max(hi for lo, hi in diff.getextrema()))
PY
done
agent-browser --session mbr-parity --args "--mute-audio" close </dev/null >/dev/null 2>&1
