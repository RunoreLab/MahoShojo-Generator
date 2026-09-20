"""Receive a verified production release, without activating it or saving tokens."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import urllib.request
import zipfile


def receive(metadata, root=Path('/opt/mahoshojo-hono')):
    digest, release_id = metadata['digest'], metadata['release_id']
    if not all(re.fullmatch(r'[a-f0-9]{64}', value) for value in (digest, release_id)):
        raise ValueError('非法 artifact / release 摘要')
    if not metadata['url'].startswith('https://'):
        raise ValueError('下载必须使用 HTTPS')
    releases = root / 'releases'
    if root.resolve() != root or releases.resolve() != releases or not releases.is_dir():
        raise ValueError('release 根目录必须是 canonical 普通目录')

    # Download API already supplies the final signed URL. Do not follow further
    # redirects (including HTTPS -> HTTP) or expose a signed URL in exceptions.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    with tempfile.TemporaryDirectory(prefix='.download-', dir=releases) as staging:
        archive = Path(staging) / 'artifact.zip'
        started = time.monotonic()
        checksum = hashlib.sha256()
        try:
            with urllib.request.build_opener(NoRedirect).open(metadata['url'], timeout=20) as response, archive.open('wb') as output:
                size = 0
                while chunk := response.read(64 * 1024):
                    size += len(chunk)
                    if time.monotonic() - started > 180 or size > 100 * 1024 * 1024:
                        raise TimeoutError()
                    checksum.update(chunk)
                    output.write(chunk)
        except Exception:
            print('artifact 下载失败或超时，请刷新临时链接重试', file=sys.stderr)
            return 42
        if checksum.hexdigest() != digest:
            raise ValueError('artifact ZIP SHA-256 不匹配')

        files = ('index.mjs', 'compose.yml', 'deploy-bundle.sh', 'release.manifest', 'release.sha256')
        candidate = Path(staging) / 'release'
        candidate.mkdir(mode=0o755)
        candidate.chmod(0o755)
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            if sorted(entry.filename for entry in entries) != sorted(files):
                raise ValueError('artifact 必须恰好包含五个 release 文件')
            if sum(entry.file_size for entry in entries) > 100 * 1024 * 1024:
                raise ValueError('artifact 解包体积过大')
            for entry in entries:
                kind = stat.S_IFMT(entry.external_attr >> 16)
                if kind not in (0, stat.S_IFREG):
                    raise ValueError('artifact 不得包含链接或特殊文件')
                (candidate / entry.filename).write_bytes(bundle.read(entry))
                (candidate / entry.filename).chmod(0o644)
        manifest = (candidate / 'release.manifest').read_bytes()
        expected = ''.join(f'{hashlib.sha256((candidate / name).read_bytes()).hexdigest()}  {name}\n' for name in files[:3])
        if (manifest != expected.encode() or hashlib.sha256(manifest).hexdigest() != release_id
                or (candidate / 'release.sha256').read_text() != f'{release_id}  release.manifest\n'):
            raise ValueError('release manifest / SHA-256 不匹配')
        (candidate / 'deploy-bundle.sh').chmod(0o755)

        # Share the existing deployment lock. Never overwrite a release which
        # might already be mounted by the running container.
        lock_fd = os.open(root / 'deploy.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lock_fd, 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            destination = releases / release_id
            if destination.is_symlink():
                raise ValueError('release 目录不得是符号链接')
            if destination.exists():
                for name in files:
                    target = destination / name
                    if target.is_symlink() or not target.is_file() or target.read_bytes() != (candidate / name).read_bytes():
                        raise ValueError('已有 release 内容不一致，拒绝覆盖')
                print('已有相同 release，校验通过，未覆盖文件')
            else:
                candidate.rename(destination)
        print(f'artifact 下载及校验完成：{time.monotonic() - started:.1f}s')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(receive(json.load(sys.stdin)))
    except Exception:
        # Never print exception text: urllib/zip errors may contain URLs/data.
        print('artifact 校验或安装失败，未执行部署', file=sys.stderr)
        sys.exit(1)
