"""Exercise actual failure cases using small synthetic photographs, never user originals."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('photo_safety', REPO / 'scripts/check-photo-safety.py')
SAFETY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SAFETY)
META = '<meta name="robots" content="noai, noimageai">'


class PhotoSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        self.photo('images/people/example.webp', (64, 48))
        self.photo('images/guard/people/example.webp', (24, 18))
        self.photo('images/gallery/people/example.webp', (32, 24))
        self.write('index.html', META + '<img src="images/people/example.webp">')
        digest = hashlib.sha1((self.root / 'images/gallery/people/example.webp').read_bytes()).hexdigest()[:8]
        self.write('gallery.html', META + f'<script>const url = "images/gallery/people/example.webp?v={digest}";</script>')
        self.write('robots.txt', (REPO / 'public/robots.txt').read_text())
        self.record()

    def write(self, name, text):
        (self.root / name).write_text(text)

    def photo(self, name, size, copyright=True, color='red'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        exif = Image.Exif()
        if copyright:
            exif[33432] = SAFETY.COPYRIGHT
        Image.new('RGB', size, color).save(path, format='WEBP', exif=exif)

    def record(self):
        assets = {}
        for path in self.root.glob('images/**/*.webp'):
            with Image.open(path) as image:
                assets[path.relative_to(self.root).as_posix()] = {
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'width': image.width, 'height': image.height,
                }
        self.write('scripts/photo-safety-manifest.json', json.dumps({'schema': 1, 'assets': assets}))

    def assert_failure(self, reason):
        self.assertTrue(any(reason in e for e in SAFETY.check(self.root)), SAFETY.check(self.root))

    def test_reviewed_exports_pass(self):
        self.assertEqual(SAFETY.check(self.root), [])

    def test_public_layout_checks_published_files(self):
        public = self.root / 'public'
        public.mkdir()
        for name in ['images', 'index.html', 'gallery.html', 'robots.txt']:
            (self.root / name).rename(public / name)
        self.assertEqual(SAFETY.check(self.root), [])
        (public / 'scan.tiff').write_text('source file')
        self.assert_failure('source/RAW format')

    def test_new_unreviewed_photo_fails(self):
        self.photo('images/people/unreviewed.webp', (64, 48))
        self.assert_failure('new/changed image')

    def test_replaced_photo_fails(self):
        self.photo('images/people/example.webp', (64, 48), color='blue')
        self.assert_failure('new/changed image')

    def test_missing_copyright_fails_even_with_matching_hash(self):
        self.photo('images/people/example.webp', (64, 48), copyright=False)
        self.record()
        self.assert_failure('missing EXIF copyright')

    def test_reviewed_phone_copy_passes_without_its_own_guard(self):
        self.photo('images/phone/people/example.webp', (32, 24))
        self.record()
        self.write('index.html', META + '<img src="images/people/example.webp" srcset="images/phone/people/example.webp 32w, images/people/example.webp 64w">')
        self.assertEqual(SAFETY.check(self.root), [])

    def test_unreviewed_phone_copy_fails(self):
        self.photo('images/phone/people/example.webp', (32, 24))
        self.assert_failure('new/changed image')

    def test_phone_copy_without_original_fails(self):
        self.photo('images/phone/people/orphan.webp', (32, 24))
        self.record()
        self.assert_failure('phone copy has no original')

    def test_phone_copy_not_smaller_fails(self):
        self.photo('images/phone/people/example.webp', (64, 48))
        self.record()
        self.assert_failure('phone copy must be a smaller copy')

    def test_missing_phone_copy_in_srcset_fails(self):
        self.write('index.html', META + '<img src="images/people/example.webp" srcset="images/phone/people/example.webp 32w">')
        self.assert_failure('missing or unsafe asset images/phone/people/example.webp')

    def test_missing_guard_fails(self):
        (self.root / 'images/guard/people/example.webp').unlink()
        self.assert_failure('missing watermarked guard')

    def test_changed_guard_requires_review(self):
        self.photo('images/guard/people/example.webp', (24, 18), color='blue')
        self.assert_failure('new/changed image')

    def test_large_guard_fails_even_if_recorded(self):
        self.photo('images/guard/people/example.webp', (400, 300))
        self.record()
        self.assert_failure('at most 360 px')

    def test_stale_gallery_hash_fails(self):
        self.write('gallery.html', META + '"images/gallery/people/example.webp?v=00000000"')
        self.assert_failure('stale content hash')

    def test_missing_gallery_hash_fails(self):
        self.write('gallery.html', META + '"images/gallery/people/example.webp"')
        self.assert_failure('add the content hash')

    def test_missing_referenced_asset_fails(self):
        self.write('index.html', META + '<img src="images/people/missing.webp">')
        self.assert_failure('missing or unsafe asset')

    def test_raw_source_fails(self):
        self.write('scan.tiff', 'not a publishable export')
        self.assert_failure('source/RAW format')

    def test_photo_outside_images_fails(self):
        self.photo('unreviewed.webp', (64, 48))
        self.assert_failure('outside the images directory')

    def test_noai_and_bot_rules_are_checked(self):
        self.write('index.html', '<img src="images/people/example.webp">')
        self.write('robots.txt', 'User-agent: *\nAllow: /\n')
        self.assert_failure('retain noai')
        self.assert_failure('missing collection restrictions')

    def test_exact_commit_is_checked_instead_of_working_tree(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL, text=True).strip()
        git('init', '-q')
        git('add', '.')
        git('-c', 'user.name=Photo check test', '-c', 'user.email=test@example.invalid',
            '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic reviewed exports')
        good = git('rev-parse', 'HEAD')
        self.write('scan.tiff', 'source file')
        command = [sys.executable, str(REPO / 'scripts/check-photo-safety.py'), '--root', str(self.root), '--git-ref']
        result = subprocess.run(command + [good], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        git('add', '.')
        git('-c', 'user.name=Photo check test', '-c', 'user.email=test@example.invalid',
            '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic unsafe source')
        bad = git('rev-parse', 'HEAD')
        (self.root / 'scan.tiff').unlink()
        result = subprocess.run(command + [bad], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('source/RAW format', result.stderr)


if __name__ == '__main__':
    unittest.main()
