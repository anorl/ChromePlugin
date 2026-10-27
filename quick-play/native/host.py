"""Windows native messaging host. No network listener or third-party Python modules."""
import json
import os
from pathlib import Path, PureWindowsPath
import struct
import sqlite3
import subprocess
import sys
import time

CONFIG = Path(__file__).with_name('config.json')
CACHE = Path(__file__).with_name('path-cache.sqlite3')
MEDIAINFO_ARGS = ('--Language=en',)
MEDIA = {'.mkv', '.mp4', '.avi', '.mov', '.m2ts', '.ts', '.wmv', '.flv', '.webm', '.mpg', '.mpeg', '.m4v'}


def default_root(config):
    roots = config.get('roots', [])
    if not roots:
        raise ValueError('请先在扩展设置中配置本地视频目录')
    if 'defaultRoot' in config:
        selected = config['defaultRoot']
        if isinstance(selected, str):
            for root in roots:
                if PureWindowsPath(selected) == PureWindowsPath(root):
                    return root
        raise ValueError('默认视频目录已失效，请在设置中重新选择并保存')
    for root in roots:
        if any(part.upper() == 'WD12T-2' for part in PureWindowsPath(root).parts):
            return root
    return roots[0]


def load_config():
    source = CONFIG if CONFIG.exists() else Path(__file__).resolve().parents[1] / 'defaults.json'
    config = json.loads(source.read_text(encoding='utf-8-sig'))
    # Read paths from the old structure, then discard obsolete metadata.
    legacy = config.pop('mappings', None)
    if not config.get('roots') and isinstance(legacy, list):
        config['roots'] = [item['root'] for item in legacy]
    if config.get('roots'):
        config['defaultRoot'] = default_root(config)
    return config


def validate_config(config):
    if not isinstance(config, dict):
        raise ValueError('配置格式错误')
    result = {}
    for key in ('potplayer', 'mediainfo'):
        value = config.get(key, '')
        if not isinstance(value, str):
            raise ValueError('程序路径格式错误')
        if value and (not Path(value).is_absolute() or not Path(value).is_file() or Path(value).suffix.lower() != '.exe'):
            raise ValueError(f'程序路径不存在或不是 exe：{value}')
        result[key] = value
    roots = config.get('roots', [])
    if not isinstance(roots, list) or not roots or len(roots) > 20:
        raise ValueError('请配置 1 至 20 个本地视频目录')
    result['roots'] = []
    for root in roots:
        if not isinstance(root, str) or not Path(root).is_absolute():
            raise ValueError(f'视频目录必须是完整的本地或网络路径：{root}')
        result['roots'].append(str(Path(root)))
    if 'defaultRoot' in config:
        result['defaultRoot'] = config['defaultRoot']
    result['defaultRoot'] = default_root(result)
    if not Path(result['defaultRoot']).is_dir():
        raise ValueError(f'默认视频目录不存在或无法访问：{result["defaultRoot"]}')
    return result


def within(path, roots):
    resolved = path.resolve()
    return any(resolved.is_relative_to(root.resolve()) for root in roots)


def cached_text(kind, key, value=None):
    """Best-effort local cache shared by the short-lived native host processes."""
    column, limit = {'paths': ('path', 500), 'reports': ('report', 50)}[kind]
    connection = None
    try:
        connection = sqlite3.connect(CACHE, timeout=0.1)
        connection.execute(f'CREATE TABLE IF NOT EXISTS {kind} (key TEXT PRIMARY KEY, {column} TEXT, expires REAL)')
        if value is None:
            row = connection.execute(f'SELECT {column} FROM {kind} WHERE key=? AND expires>?', (key, time.time())).fetchone()
            return row[0] if row else None
        connection.execute(f'INSERT OR REPLACE INTO {kind} VALUES (?, ?, ?)', (key, value, time.time() + 600))
        connection.execute(f'DELETE FROM {kind} WHERE expires<=?', (time.time(),))
        connection.execute(f'DELETE FROM {kind} WHERE key NOT IN (SELECT key FROM {kind} ORDER BY expires DESC LIMIT {limit})')
        connection.commit()
    except (sqlite3.Error, OSError):
        # A locked or unwritable cache must never prevent opening the video.
        return None
    finally:
        if connection is not None:
            connection.close()


def path_cache(key, path=None):
    value = cached_text('paths', key, str(path) if path is not None else None)
    return Path(value) if value else None


def find_file(filename, roots, timeout=25):
    if not isinstance(filename, str) or not filename or len(filename) > 4096:
        raise ValueError('文件名为空或过长')
    relative = PureWindowsPath(filename.replace('/', '\\'))
    if relative.drive or relative.root or '..' in relative.parts or ':' in filename or '\x00' in filename:
        raise ValueError('网页文件名必须是安全的相对路径')
    if relative.suffix.lower() not in MEDIA:
        raise ValueError('只支持视频文件')
    roots = [Path(root).resolve() for root in roots]
    if not roots:
        raise ValueError('请先在扩展设置中配置本地视频目录')
    for root in roots:
        if not root.is_dir():
            raise ValueError(f'视频目录无法访问：{root}')
    matches = set()
    for root in roots:
        candidate = root.joinpath(*relative.parts)
        if candidate.is_file() and within(candidate, roots):
            matches.add(candidate.resolve())
    # Single-file torrents commonly use <video stem>/<video filename>.
    # Treat this deterministic location like an explicit relative-path match.
    if not matches and len(relative.parts) == 1:
        for root in roots:
            candidate = root / relative.stem / relative.name
            if candidate.is_file() and within(candidate, roots):
                matches.add(candidate.resolve())
    cache_key = json.dumps({'roots': [str(root).casefold() for root in roots], 'filename': relative.as_posix().casefold()})
    if not matches:
        cached = path_cache(cache_key)
        if cached is not None and cached.is_file() and within(cached, roots):
            return cached.resolve()
    if not matches:
        deadline = time.monotonic() + timeout
        errors = []
        def onerror(error):
            errors.append(str(error))
        for root in roots:
            for folder, directories, files in os.walk(root, followlinks=False, onerror=onerror):
                if time.monotonic() > deadline:
                    raise ValueError('查找超时，请把视频目录配置得更具体后重试')
                # Do not follow Windows junctions into unrelated directories.
                directories[:] = [name for name in directories if not Path(folder, name).is_symlink()
                                   and not (hasattr(Path(folder, name), 'is_junction') and Path(folder, name).is_junction())]
                for name in files:
                    if name.casefold() == relative.name.casefold():
                        candidate = Path(folder, name)
                        if within(candidate, roots):
                            matches.add(candidate.resolve())
                if len(matches) > 20:
                    raise ValueError('同名文件过多，请缩小视频根目录范围')
        if errors:
            raise ValueError('部分目录无法读取，请调整目录或权限后重试：' + errors[0])
    if len(matches) > 1:
        raise ValueError('发现多个同名文件，请缩小配置目录：\n' + '\n'.join(map(str, sorted(matches))))
    if not matches:
        raise ValueError(f'本地未找到：{relative.name}。请检查文件是否已下载、文件名是否一致、根目录是否正确。')
    found = next(iter(matches))
    path_cache(cache_key, found)
    return found


def handle(message):
    action = message.get('action')
    if action == 'status':
        return {'ok': True, 'config': load_config()}
    if action == 'configure':
        config = validate_config(message.get('config'))
        temporary = CONFIG.with_suffix('.tmp')
        temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(CONFIG)
        return {'ok': True, 'config': config}
    if action not in ('play', 'info'):
        raise ValueError('不支持的操作')
    config = load_config()
    key = 'potplayer' if action == 'play' else 'mediainfo'
    executable = config.get(key, '')
    if not executable or not Path(executable).is_file():
        raise ValueError('请先配置 PotPlayer 程序路径' if action == 'play' else '请先配置 MediaInfo 命令行版路径')
    root = default_root(config)
    try:
        path = find_file(message.get('filename'), [root])
    except ValueError as error:
        raise ValueError(f'{error}\n当前默认目录：{root}。可在设置中切换默认视频目录。') from error
    if action == 'play':
        subprocess.Popen([executable, str(path)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, close_fds=True)
        return {'ok': True, 'path': str(path)}
    file_stat, tool_stat = path.stat(), Path(executable).stat()
    report_key = json.dumps([str(path), file_stat.st_size, file_stat.st_mtime_ns,
                             executable, tool_stat.st_size, tool_stat.st_mtime_ns, MEDIAINFO_ARGS])
    cached_report = cached_text('reports', report_key)
    if cached_report:
        return {'ok': True, 'path': str(path), 'text': cached_report}
    result = subprocess.run([executable, *MEDIAINFO_ARGS, str(path)], capture_output=True,
                            timeout=40, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('MediaInfo 读取失败，请检查是否配置了 CLI 版本')
    text = result.stdout.decode('utf-8-sig', errors='replace').strip()
    if not text or '\ufffd' in text:
        raise ValueError('MediaInfo 未返回有效 UTF-8 信息，请使用新版 MediaInfo CLI')
    if len(text.encode('utf-8')) > 800000:
        raise ValueError('媒体信息过长，超过单次传输上限')
    cached_text('reports', report_key, text)
    return {'ok': True, 'path': str(path), 'text': text}


def read_exact(stream, count):
    result = bytearray()
    while len(result) < count:
        chunk = stream.read(count - len(result))
        if not chunk:
            raise EOFError('消息不完整')
        result.extend(chunk)
    return bytes(result)


def main():
    if sys.platform == 'win32':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    stream = sys.stdin.buffer
    header = read_exact(stream, 4)
    length = struct.unpack('<I', header)[0]
    if not 0 < length <= 65536:
        raise ValueError('消息大小无效')
    try:
        message = json.loads(read_exact(stream, length).decode('utf-8'))
        result = handle(message)
    except Exception as error:
        result = {'ok': False, 'error': str(error)}
    output = json.dumps(result, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(output)) + output)
    sys.stdout.buffer.flush()


if __name__ == '__main__':
    main()
