#!/bin/sh
# Rebuilds yurei-extension/icons from assets/yurei.png. Needs python3 with Pillow.
set -e
cd "$(dirname "$0")/.."
python3 - <<'PY'
from PIL import Image

# The head and hood, framed square. The whole figure is too tall and thin to fill a 16 px toolbar slot:
# scaled to fit, the face lands on four pixels. Chrome's own buttons and the extensions people keep
# fill their canvas edge to edge, so the icon shows the part of the ghost that still reads that small.
HEAD = (187, 85, 487, 385)

src = Image.open("assets/yurei.png").convert("RGBA")
head = src.crop(HEAD)
side = max(head.size)
art = Image.new("RGBA", (side, side), (0, 0, 0, 0))
art.paste(head, ((side - head.width) // 2, (side - head.height) // 2), head)

for size in (16, 32, 48, 128):
    inner = round(size * 0.99)
    scaled = art.resize((inner, inner), Image.LANCZOS)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(scaled, ((size - inner) // 2, (size - inner) // 2), scaled)
    icon.save(f"yurei-extension/icons/icon-{size}.png", "PNG", optimize=True)
    print(f"yurei-extension/icons/icon-{size}.png")
PY
