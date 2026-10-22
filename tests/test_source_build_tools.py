import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import source_runtime as runtime
import electron_source as electron


class SourceBuildTests(unittest.TestCase):
    def test_corrupt_archive_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packed = root / 'bad.archive'
            packed.write_bytes(b'corrupt source')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                runtime.prepare('node', root / 'prepared', packed)
            self.assertFalse((root / 'prepared/source').exists())

    def test_tar_traversal_cannot_escape_source_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packed = root / 'bad.tar'
            with tarfile.open(packed, 'w') as archive:
                entry = tarfile.TarInfo('../outside')
                entry.size = 1
                archive.addfile(entry, io.BytesIO(b'x'))
            with self.assertRaises(tarfile.FilterError):
                runtime.extract(packed, root / 'unpacked')
            self.assertFalse((root / 'outside').exists())

    def test_zip_traversal_cannot_escape_runtime_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packed = root / 'bad.zip'
            with zipfile.ZipFile(packed, 'w') as archive:
                archive.writestr('../outside', 'bad')
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                electron.unpack_distribution(packed, root / 'out')
            self.assertFalse((root / 'outside').exists())

    def test_compilation_fails_before_commands_or_output_with_external_network(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(runtime.socket, 'if_nameindex', return_value=[(1, 'lo'), (2, 'eth0')]), patch.object(runtime, 'execute') as execute:
            root = Path(temp)
            with self.assertRaisesRegex(RuntimeError, 'isolated network'):
                runtime.build('node', root / 'missing', root / 'output', 2)
            self.assertFalse((root / 'output').exists())
            execute.assert_not_called()

    def test_changed_lock_fails_before_compilation(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(runtime, 'require_offline', return_value=['lo']), patch.object(runtime, 'execute') as execute:
            root = Path(temp)
            prepared = root / 'prepared'
            prepared.mkdir()
            (prepared / 'prepared.json').write_text(json.dumps({'component': 'node', 'lockSha256': 'stale'}))
            with self.assertRaisesRegex(ValueError, 'source lock'):
                runtime.build('node', prepared, root / 'output', 2)
            execute.assert_not_called()
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
