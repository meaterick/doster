#!/usr/bin/env python3
"""Make the smaller phone copies of the main exhibition photographs.

Each public/images/<category>/<photo>.webp gets public/images/phone/<category>/<photo>.webp,
1440 px wide (enough for a 440 px wide phone screen at 3x plus the 10% scroll zoom).
The originals are only read, never changed. EXIF (copyright, artist, description)
is copied from the original; GPS is never written.

index.html serves these copies to phones through srcset; tablets, desktops and the
photo viewer keep the originals. After running this, look at every new copy and add
only the copies you checked to scripts/photo-safety-manifest.json.

Usage: python3 scripts/make-phone-copies.py images/people/photo01.webp [...]
       (paths relative to public/; no arguments = every photo index.html uses)
"""
import re
import sys
from pathlib import Path

from PIL import Image

PHONE_WIDTH = 1440
QUALITY = 86
PUBLIC = Path(__file__).resolve().parent.parent / 'public'
# The entrance photo fills a tall phone screen (object-fit: cover) and needs the original.
SKIP = {'images/hero.webp'}


def page_photos():
    html = (PUBLIC / 'index.html').read_text()
    names = re.findall(r'<img[^>]*\ssrc="(images/[^"?]+\.webp)', html)
    return [n for n in dict.fromkeys(names) if n not in SKIP and not n.startswith('images/phone/')]


def make(name):
    source = PUBLIC / name
    target = PUBLIC / 'images/phone' / name.removeprefix('images/')
    with Image.open(source) as image:
        if image.width <= PHONE_WIDTH:
            print(f'skip {name}: already {image.width} px wide')
            return
        exif = image.getexif()
        exif.pop(34853, None)  # GPS
        height = round(image.height * PHONE_WIDTH / image.width)
        small = image.convert('RGB').resize((PHONE_WIDTH, height), Image.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    small.save(target, 'WEBP', quality=QUALITY, method=6, exif=exif.tobytes())
    print(f'{name} -> {target.relative_to(PUBLIC)} ({PHONE_WIDTH}x{height}, '
          f'{source.stat().st_size // 1024} KB -> {target.stat().st_size // 1024} KB)')


def main():
    for name in sys.argv[1:] or page_photos():
        make(name)


if __name__ == '__main__':
    main()
