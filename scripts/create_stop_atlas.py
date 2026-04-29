#!/usr/bin/env python3
"""
create_stop_atlas.py
====================
Creates a horizontal PNG sprite atlas from three SVG stop icons.

Output: icon-stop-atlas.png (144x48px — three 48x48 sprites side by side)
  x=0   → icon-stop-regular.svg  (blue  — regular stop)
  x=48  → icon-stop-start.svg    (green — first stop / boarding)
  x=96  → icon-stop-end.svg      (red   — last stop / alighting)

Requires: cairosvg, Pillow
  pip install cairosvg Pillow
"""

import os
from io import BytesIO

try:
    import cairosvg
    from PIL import Image
except ImportError:
    print("Missing dependencies. Install with: pip install cairosvg Pillow")
    raise


def create_stop_atlas():
    """Builds a 144x48 PNG atlas from the three SVG stop icons."""
    script_dir   = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    core_dir     = os.path.join(
        project_root,
        'backend', 'traffic-insight', 'src', 'main',
        'resources', 'static', 'js', 'core'
    )

    # Icons in atlas order: regular → start → end
    icons = [
        'icon-stop-regular.svg',
        'icon-stop-start.svg',
        'icon-stop-end.svg',
    ]

    ICON_SIZE   = 48
    atlas_width = ICON_SIZE * len(icons)
    atlas       = Image.new('RGBA', (atlas_width, ICON_SIZE), (0, 0, 0, 0))

    print(f"Building atlas in: {core_dir}")

    for i, icon_file in enumerate(icons):
        svg_path = os.path.join(core_dir, icon_file)

        if not os.path.exists(svg_path):
            print(f"  SVG not found: {svg_path}")
            continue

        try:
            png_data = cairosvg.svg2png(
                url=svg_path,
                output_width=ICON_SIZE,
                output_height=ICON_SIZE
            )
            icon_img = Image.open(BytesIO(png_data)).convert('RGBA')

            if icon_img.size != (ICON_SIZE, ICON_SIZE):
                icon_img = icon_img.resize((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS)

            x_offset = i * ICON_SIZE
            atlas.paste(icon_img, (x_offset, 0), icon_img)
            print(f"  Added: {icon_file} at x={x_offset}px")

        except Exception as e:
            print(f"  Error processing {icon_file}: {e}")

    output_path = os.path.join(core_dir, 'icon-stop-atlas.png')
    atlas.save(output_path, 'PNG')

    print(f"\nAtlas created: {output_path}")
    print(f"  Dimensions : {atlas.size[0]}x{atlas.size[1]}px")
    print(f"  Sprites    : {len(icons)} icons at {ICON_SIZE}x{ICON_SIZE}px each")


if __name__ == '__main__':
    create_stop_atlas()
