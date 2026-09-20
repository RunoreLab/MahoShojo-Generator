import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/receive-hono-artifact.py'
spec = importlib.util.spec_from_file_location('receiver', SCRIPT)
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ReceiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'releases').mkdir()
        self.files = {'index.mjs': b'example', 'compose.yml': b'compose', 'deploy-bundle.sh': b'#!/bin/sh\nexit 99\n'}
        manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in self.files.items()).encode()
        self.release_id = hashlib.sha256(manifest).hexdigest()
        self.files['release.manifest'] = manifest
        self.files['release.sha256'] = f'{self.release_id}  release.manifest\n'.encode()

    def run_receive(self, digest=None):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as bundle:
            for name, content in self.files.items():
                bundle.writestr(name, content)
        data = archive.getvalue()
        metadata = {'url': 'https://artifact.invalid/?secret=signed', 'digest': digest or hashlib.sha256(data).hexdigest(), 'release_id': self.release_id}
        with patch.object(receiver.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = io.BytesIO(data)
            return receiver.receive(metadata, self.root)

    def test_download_verify_and_reuse_without_overwrite_or_execution(self):
        self.assertEqual(self.run_receive(), 0)
        target = self.root / 'releases' / self.release_id
        inode = (target / 'index.mjs').stat().st_ino
        self.assertEqual((target / 'deploy-bundle.sh').stat().st_mode & 0o777, 0o755)
        self.assertEqual(target.stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.run_receive(), 0)
        self.assertEqual((target / 'index.mjs').stat().st_ino, inode)
        self.assertEqual(list((self.root / 'releases').iterdir()), [target])

    def test_digest_mismatch_never_installs(self):
        with self.assertRaises(ValueError):
            self.run_receive('0' * 64)
        self.assertEqual(list((self.root / 'releases').iterdir()), [])

    def test_manifest_mismatch_never_installs(self):
        self.files['index.mjs'] = b'tampered'
        with self.assertRaises(ValueError):
            self.run_receive()
        self.assertEqual(list((self.root / 'releases').iterdir()), [])

    def test_archive_paths_cannot_escape(self):
        self.files['../escape'] = b'bad'
        with self.assertRaises(ValueError):
            self.run_receive()
        self.assertFalse((self.root / 'escape').exists())

    def test_existing_release_is_not_overwritten(self):
        self.run_receive()
        existing = self.root / 'releases' / self.release_id / 'index.mjs'
        existing.write_bytes(b'existing')
        with self.assertRaises(ValueError):
            self.run_receive()
        self.assertEqual(existing.read_bytes(), b'existing')

    def test_destination_symlink_is_rejected(self):
        (self.root / 'releases' / self.release_id).symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.run_receive()
        self.assertFalse((self.root / 'index.mjs').exists())

    def test_download_failure_is_retryable_and_leaves_no_files(self):
        with patch.object(receiver.urllib.request, 'build_opener', side_effect=TimeoutError('private URL')):
            self.assertEqual(receiver.receive({'url': 'https://artifact.invalid', 'digest': '0' * 64, 'release_id': self.release_id}, self.root), 42)
        self.assertEqual(list((self.root / 'releases').iterdir()), [])

    def test_cli_errors_do_not_expose_signed_url(self):
        result = subprocess.run(['python3', str(SCRIPT)], input=json.dumps({'url': 'https://artifact.invalid/?secret=signed'}), capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('secret', result.stderr)


if __name__ == '__main__':
    unittest.main()
