#!/usr/bin/env python3
"""Read-only checks for DOSTER's reviewed web exports. Never rewrites images."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import parse_qs, urlsplit

from PIL import Image

COPYRIGHT = '(c) 2026 DOSTER (Dohyeon). All rights reserved.'
RAW_EXTENSIONS = {
    '.arw', '.cr2', '.cr3', '.dng', '.nef', '.nrw', '.orf', '.pef', '.raf',
    '.raw', '.rw2', '.srw', '.tif', '.tiff', '.psd', '.psb', '.heic', '.heif',
}
RASTER_EXTENSIONS = {'.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.bmp'}
ICONS = {'apple-touch-icon.png', 'favicon-32.png'}
IMAGE_URL = re.compile(r"images/[A-Za-z0-9_./-]+\.(?:webp|jpg|jpeg|png|glb)(?:\?v=[A-Za-z0-9]+)?")


class PageImages(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.images = []
        self.robots = set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'img' and attrs.get('src', '').startswith('images/'):
            self.images.append(urlsplit(attrs['src']).path)
        if tag == 'meta' and attrs.get('name', '').lower() == 'robots':
            self.robots.update(x.strip().lower() for x in attrs.get('content', '').split(','))


def check(root):
    errors = []
    manifest = json.loads((root / 'scripts/photo-safety-manifest.json').read_text())
    if manifest.get('schema') != 1:
        return ['Unsupported photo safety manifest schema.']
    # This repository serves the static exhibition from public/.
    root = root / 'public' if (root / 'public').is_dir() else root
    approved = manifest['assets']
    photos = {}
    profiles = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if any(p in {'.git', '.venv', 'node_modules', '__pycache__'} for p in relative.parts):
            continue
        if not path.is_file() and not path.is_symlink():
            continue
        name = relative.as_posix()
        suffix = path.suffix.lower()
        if path.is_symlink():
            errors.append(f'{name}: symlinks are not allowed in the published source.')
            continue
        if suffix in RAW_EXTENSIONS:
            errors.append(f'{name}: source/RAW format must not be published; use a reviewed web export.')
        if suffix in RASTER_EXTENSIONS and not name.startswith('images/') and name not in ICONS:
            errors.append(f'{name}: unreviewed image outside the images directory.')
        if not name.startswith('images/'):
            continue
        if name.startswith('images/gallery/models/'):
            if suffix != '.glb':
                errors.append(f'{name}: only GLB display models are allowed here.')
            continue
        if name.startswith('images/gallery/tex/'):
            if suffix != '.webp':
                errors.append(f'{name}: display materials must be WebP.')
            continue
        expected_format = 'JPEG' if name.startswith('images/share/') else 'WEBP'
        if suffix != ('.jpg' if expected_format == 'JPEG' else '.webp'):
            errors.append(f'{name}: use a reviewed {expected_format} web export.')
            continue
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        entry = approved.get(name)
        if not isinstance(entry, dict) or entry.get('sha256') != digest:
            errors.append(f'{name}: new/changed image needs visual review and an updated approval record.')
        try:
            with Image.open(path) as image:
                if image.format != expected_format:
                    errors.append(f'{name}: file contents do not match its web format.')
                photos[name] = image.size
                profiles[name] = image.info.get('icc_profile') or None
                if entry and (entry.get('width'), entry.get('height')) != image.size:
                    errors.append(f'{name}: dimensions do not match the reviewed export.')
                exif = image.getexif()
                if COPYRIGHT not in str(exif.get(33432, '')):
                    errors.append(f'{name}: missing EXIF copyright notice.')
                if 34853 in exif:
                    errors.append(f'{name}: remove GPS metadata before publication.')
                if name.startswith('images/share/') and image.size != (1200, 630):
                    errors.append(f'{name}: share preview must be 1200 x 630.')
                image.verify()
        except (OSError, ValueError, SyntaxError) as error:
            errors.append(f'{name}: cannot read image ({type(error).__name__}).')

    for name in approved:
        if name not in photos:
            errors.append(f'{name}: reviewed image is missing or invalid; review its record and references.')

    for name, size in photos.items():
        if name.startswith('images/phone/'):
            # Phone copy: shown instead of its original on small screens and protected by the original's guard.
            original = 'images/' + name.removeprefix('images/phone/')
            original_size = photos.get(original)
            if original_size is None:
                errors.append(f'{name}: phone copy has no original {original}.')
            elif size[0] >= original_size[0] or abs(size[0] / size[1] - original_size[0] / original_size[1]) > 0.01:
                errors.append(f'{name}: phone copy must be a smaller copy of {original} with the same shape.')
            elif profiles.get(name) != profiles.get(original):
                errors.append(f'{name}: phone copy must keep the colour profile of {original}, or its colours change.')
            continue
        if name.startswith(('images/gallery/', 'images/guard/', 'images/share/')):
            continue
        guard = 'images/guard/' + name.removeprefix('images/')
        guard_size = photos.get(guard)
        if guard_size is None:
            errors.append(f'{name}: missing watermarked guard {guard}.')
        elif max(guard_size) > 360 or max(guard_size) >= max(size):
            errors.append(f'{guard}: guard must be a small copy, at most 360 px on its longest edge.')

    for filename in ['index.html', 'gallery.html']:
        source = (root / filename).read_text()
        page = PageImages(source)
        if not {'noai', 'noimageai'} <= page.robots:
            errors.append(f'{filename}: retain noai and noimageai metadata.')
        for name in page.images:
            if name not in photos:
                errors.append(f'{filename}: {name} is not a reviewed photograph.')
        for url in sorted(set(IMAGE_URL.findall(source))):
            parsed = urlsplit(url)
            path = root / parsed.path
            if not path.is_file() or path.is_symlink():
                errors.append(f'{filename}: missing or unsafe asset {parsed.path}.')
                continue
            version = parse_qs(parsed.query).get('v', [''])[0]
            if filename == 'gallery.html' and not version:
                errors.append(f'{filename}: add the content hash to {parsed.path}.')
            if version and version != hashlib.sha1(path.read_bytes()).hexdigest()[:8]:
                errors.append(f'{filename}: stale content hash for {parsed.path}.')

    # Check each existing blocked bot rather than relying on a generic Disallow elsewhere.
    robots = (root / 'robots.txt').read_text()
    required_bots = {'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web',
                     'anthropic-ai', 'ccbot', 'google-extended', 'applebot-extended',
                     'bytespider', 'amazonbot', 'meta-externalagent', 'facebookbot',
                     'perplexitybot', 'cohere-ai', 'diffbot', 'omgilibot', 'imagesiftbot', 'timpibot'}
    blocked = set()
    agents = []
    has_rules = False
    for line in robots.splitlines():
        key, sep, value = line.partition('#')[0].partition(':')
        if not sep:
            continue
        key, value = key.strip().lower(), value.strip().lower()
        if key == 'user-agent':
            if has_rules:
                agents, has_rules = [], False
            agents.append(value)
        else:
            has_rules = True
            if key == 'disallow' and value == '/':
                blocked.update(agents)
    if required_bots - blocked:
        errors.append('robots.txt: missing collection restrictions for ' + ', '.join(sorted(required_bots - blocked)))
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--git-ref', help='Validate the exact commit being pushed, including all its files.')
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.git_ref:
            if not re.fullmatch(r'[a-fA-F0-9]{40,64}', args.git_ref):
                parser.error('--git-ref must be a full commit SHA')
            with tempfile.TemporaryDirectory(prefix='doster-photo-check-') as directory:
                snapshot = Path(directory)
                archive = snapshot / 'source.tar'
                with archive.open('wb') as output:
                    subprocess.run(['git', '-C', str(root), 'archive', args.git_ref], stdout=output, check=True)
                with tarfile.open(archive) as source:
                    # Inspect links before extraction; data-filter may normalize internal links.
                    if any(item.issym() or item.islnk() for item in source.getmembers()):
                        raise ValueError('Published source must not contain symbolic or hard links.')
                    source.extractall(snapshot / 'source', filter='data')
                errors = check(snapshot / 'source')
        else:
            errors = check(root)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f'Photo safety check could not complete: {error}', file=sys.stderr)
        return 1
    if errors:
        print('Photo safety check FAILED:', file=sys.stderr)
        for error in errors:
            print(' - ' + error, file=sys.stderr)
        return 1
    print('Photo safety check passed: reviewed exports, guards, copyright, metadata, references and hashes.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
