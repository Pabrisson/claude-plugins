#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""The bench's made pictures, from a free photo (spec § 13.4): no place name, no provider logo, only the interface a
real capture would show around the picture.

  bench-make.py screenshot <in.jpg> <out.jpg>                                    a phone screenshot of a photo app
  bench-make.py streetview <in.jpg> <out.jpg> --heading 87 --date "Jul 2019"     a street-level viewer: compass, date
"""
import argparse
import math

from PIL import Image, ImageDraw, ImageFont


def font(size):
    for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def screenshot(src, out):
    im = Image.open(src).convert("RGB")
    w = 1080
    h = round(im.height * w / im.width)
    can = Image.new("RGB", (w, 96 + 132 + h + 150), (18, 18, 18))
    d = ImageDraw.Draw(can)
    d.text((40, 30), "14:06", fill="white", font=font(34))
    d.rectangle((w - 120, 38, w - 50, 66), outline="white", width=3)
    d.rectangle((w - 116, 42, w - 72, 62), fill="white")
    d.text((40, 118), "<", fill="white", font=font(56))
    d.text((100, 128), "Photos", fill="white", font=font(40))
    can.paste(im.resize((w, h)), (0, 228))
    for i in range(4):
        x = 90 + i * 260
        d.rounded_rectangle((x, 228 + h + 40, x + 70, 228 + h + 110), radius=14, outline="white", width=4)
    can.save(out, quality=92)


def streetview(src, out, heading, date):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    w, h = im.size
    r = max(40, w // 22)
    cx, cy = w - r - 30, h - r - 30
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255), outline=(60, 60, 60), width=3)
    a = math.radians(-heading)  # the view looks along heading: north is turned by -heading
    pt = lambda k, t: (cx + r * k * math.sin(t), cy - r * k * math.cos(t))  # noqa: E731
    d.polygon([pt(0.8, a), pt(0.25, a - math.pi / 2), pt(0.25, a + math.pi / 2)], fill=(220, 40, 40))
    f = font(max(14, w // 60))
    label = f"Image capture: {date}"
    d.rectangle((20, h - 60, 40 + d.textlength(label, font=f), h - 20), fill=(0, 0, 0))
    d.text((30, h - 55), label, fill="white", font=f)
    im.save(out, quality=92)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["screenshot", "streetview"])
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--heading", type=float, default=0)
    ap.add_argument("--date", default="")
    a = ap.parse_args()
    if a.kind == "screenshot":
        screenshot(a.src, a.out)
    else:
        streetview(a.src, a.out, a.heading, a.date)
