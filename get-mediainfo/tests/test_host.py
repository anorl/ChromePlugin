import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HOST = Path(__file__).resolve().parents[1] / 'native' / 'host.py'
spec = importlib.util.spec_from_file_location('host', HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        cache = patch.object(host, 'CACHE', self.root / 'lookup.sqlite3')
        cache.start()
        self.addCleanup(cache.stop)

    def video(self, relative):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'test')
        return path.resolve()

    def test_nested_unicode_and_relative_paths(self):
        path = self.video('电影/movie.mkv')
        self.assertEqual(host.find_file('电影/movie.mkv', [self.root]), path)
        self.assertEqual(host.find_file('movie.mkv', [self.root]), path)

    def test_reject_unsafe_paths_and_nonmedia(self):
        for value in ('../movie.mkv', 'a/../../movie.mkv', 'C:\\movie.mkv', '\\\\nas\\movie.mkv', '/movie.mkv', 'movie.mkv:other', 'tool.exe', '', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                host.find_file(value, [self.root])

    def test_ambiguous_and_direct_priority(self):
        first = self.video('a/movie.mkv')
        self.video('b/movie.mkv')
        with self.assertRaisesRegex(ValueError, '多个同名'):
            host.find_file('movie.mkv', [self.root])
        self.assertEqual(host.find_file('a/movie.mkv', [self.root]), first)

    def test_same_named_folder_avoids_full_scan(self):
        expected = self.video('movie/movie.mkv')
        self.video('other/movie.mkv')
        with patch.object(host.os, 'walk', side_effect=AssertionError('Full scan is unnecessary')):
            self.assertEqual(host.find_file('movie.mkv', [self.root]), expected)

    def test_cached_lookup_avoids_rescan_and_recovers_after_move(self):
        original = self.video('nested/first/movie.mkv')
        self.assertEqual(host.find_file('movie.mkv', [self.root]), original)
        with patch.object(host.os, 'walk', side_effect=AssertionError('Cached result must avoid scanning')):
            self.assertEqual(host.find_file('movie.mkv', [self.root]), original)
        original.unlink()
        moved = self.video('nested/second/movie.mkv')
        self.assertEqual(host.find_file('movie.mkv', [self.root]), moved)

    def test_cache_is_scoped_to_root_and_cannot_escape_it(self):
        first = self.video('a/nested/movie.mkv')
        second = self.video('b/nested/movie.mkv')
        self.assertEqual(host.find_file('movie.mkv', [self.root / 'a']), first)
        self.assertEqual(host.find_file('movie.mkv', [self.root / 'b']), second)
        with patch.object(host, 'path_cache', return_value=first):
            self.assertEqual(host.find_file('movie.mkv', [self.root / 'b']), second)

    def test_expired_cache_does_not_hide_new_ambiguity(self):
        self.video('a/movie.mkv')
        host.find_file('movie.mkv', [self.root])
        self.video('b/movie.mkv')
        with patch.object(host.time, 'time', return_value=time.time() + 601):
            with self.assertRaisesRegex(ValueError, '多个同名'):
                host.find_file('movie.mkv', [self.root])

    def test_missing_and_unreachable_roots(self):
        with self.assertRaisesRegex(ValueError, '未找到'):
            host.find_file('none.mkv', [self.root])
        with self.assertRaisesRegex(ValueError, '无法访问'):
            host.find_file('none.mkv', [self.root / 'missing'])

    def test_symlink_cannot_escape_root(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'movie.mkv'
            target.write_bytes(b'test')
            link = self.root / 'movie.mkv'
            try:
                link.symlink_to(target)
            except OSError:
                self.skipTest('Windows account cannot create symlinks')
            with self.assertRaisesRegex(ValueError, '未找到'):
                host.find_file('movie.mkv', [self.root])

    def test_play_uses_literal_argument_not_shell(self):
        path = self.video('a & echo test.mkv')
        exe = self.root / 'PotPlayer.exe'
        exe.touch()
        with patch.object(host, 'load_config', return_value={'roots': [str(self.root)], 'potplayer': str(exe)}), patch.object(host.subprocess, 'Popen') as launch:
            result = host.handle({'action': 'play', 'filename': path.name})
            self.assertTrue(result['ok'])
            self.assertEqual(launch.call_args.args[0], [str(exe), str(path)])
            self.assertNotIn('shell', launch.call_args.kwargs)

    def test_info_unicode_and_tool_failure(self):
        path = self.video('电影.mp4')
        exe = self.root / 'MediaInfo.exe'
        exe.touch()
        config = {'roots': [str(self.root)], 'mediainfo': str(exe)}
        file_stat, tool_stat = path.stat(), exe.stat()
        old_key = json.dumps([str(path), file_stat.st_size, file_stat.st_mtime_ns,
                              str(exe), tool_stat.st_size, tool_stat.st_mtime_ns, '--Language=raw --Full'])
        host.cached_text('reports', old_key, 'obsolete raw report')
        with patch.object(host, 'load_config', return_value=config), patch.object(host.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, 'General\n电影'.encode('utf-8'), b'')
            self.assertEqual(host.handle({'action': 'info', 'filename': path.name})['text'], 'General\n电影')
            self.assertEqual(run.call_args.args[0], [str(exe), '--Language=en', str(path)])
            self.assertEqual(host.handle({'action': 'info', 'filename': path.name})['text'], 'General\n电影')
            self.assertEqual(run.call_count, 1)
            path.write_bytes(b'changed-file')
            run.return_value = subprocess.CompletedProcess([], 1, b'', b'bad')
            with self.assertRaisesRegex(ValueError, '读取失败'):
                host.handle({'action': 'info', 'filename': path.name})
            self.assertEqual(run.call_count, 2)

    def test_native_message_framing(self):
        data = json.dumps({'action': 'unsupported'}).encode()
        result = subprocess.run([sys.executable, str(HOST)], input=struct.pack('<I', len(data)) + data, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        length = struct.unpack('<I', result.stdout[:4])[0]
        self.assertEqual(length, len(result.stdout[4:]))
        response = json.loads(result.stdout[4:])
        self.assertFalse(response['ok'])
        self.assertIn('不支持', response['error'])

    def test_config_and_partial_read(self):
        with self.assertRaises(ValueError):
            host.validate_config({'roots': []})
        with patch.object(host, 'CONFIG', self.root / 'config.json'):
            host.handle({'action': 'configure', 'config': {'roots': [str(self.root)]}})
            self.assertEqual(host.handle({'action': 'status'})['config']['roots'], [str(self.root)])
        with self.assertRaises(EOFError):
            host.read_exact(io.BytesIO(b'xx'), 4)

    def test_defaults_and_existing_config_precedence(self):
        with patch.object(host, 'CONFIG', self.root / 'config.json'):
            config = host.load_config()
            self.assertEqual(len(config['roots']), 6)
            self.assertEqual(config['roots'][0], r'\\192.168.12.20\data\sda')
            self.assertEqual(config['defaultRoot'], r'\\192.168.12.20\data\WD12T-2\down')
            host.CONFIG.write_text(json.dumps({'roots': [str(self.root)], 'potplayer': ''}), encoding='utf-8')
            self.assertEqual(host.load_config(), {'roots': [str(self.root)], 'potplayer': '', 'defaultRoot': str(self.root)})

    def test_old_configuration_keeps_paths_and_default(self):
        with patch.object(host, 'CONFIG', self.root / 'config.json'):
            host.CONFIG.write_text(json.dumps({'mappings': [{'root': str(self.root)}], 'defaultRoot': str(self.root)}), encoding='utf-8')
            self.assertEqual(host.load_config(), {'roots': [str(self.root)], 'defaultRoot': str(self.root)})

    def test_selected_disk_only_even_with_duplicate_on_other_disk(self):
        self.video('first/movie.mkv')
        selected = self.video('second/movie.mkv')
        exe = self.root / 'player.exe'
        exe.touch()
        config = {'potplayer': str(exe), 'mediainfo': str(exe),
                  'roots': [str(self.root / 'first'), str(self.root / 'second'), str(self.root / 'offline')],
                  'defaultRoot': str(self.root / 'second')}
        self.assertEqual(host.validate_config(config)['defaultRoot'], config['defaultRoot'])
        with patch.object(host, 'load_config', return_value=config), patch.object(host.subprocess, 'Popen') as launch, patch.object(host.subprocess, 'run') as read:
            self.assertEqual(host.handle({'action': 'play', 'filename': 'movie.mkv'})['path'], str(selected))
            self.assertEqual(launch.call_args.args[0], [str(exe), str(selected)])
            read.return_value = subprocess.CompletedProcess([], 0, b'General', b'')
            self.assertEqual(host.handle({'action': 'info', 'filename': 'movie.mkv'})['path'], str(selected))
            self.video('first/only-on-first.mkv')
            with self.assertRaisesRegex(ValueError, '当前默认目录'):
                host.handle({'action': 'play', 'filename': 'only-on-first.mkv'})

    def test_legacy_default_and_invalid_selection(self):
        config = {'roots': ['D:\\sda', 'D:\\WD12T-2\\down']}
        self.assertEqual(host.default_root(config), 'D:\\WD12T-2\\down')
        config['defaultRoot'] = 'D:\\removed'
        with self.assertRaisesRegex(ValueError, '重新选择'):
            host.default_root(config)


if __name__ == '__main__':
    unittest.main()
