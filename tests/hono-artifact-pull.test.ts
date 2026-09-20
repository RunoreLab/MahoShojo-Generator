import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pullHonoArtifact } from '../scripts/pull-hono-artifact.mjs';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawnSync: vi.fn(),
}));

const env = {
  GITHUB_TOKEN: 'runner-token', GITHUB_REPOSITORY: 'owner/repo', ARTIFACT_ID: '123',
  ARTIFACT_DIGEST: 'a'.repeat(64), RELEASE_ID: 'b'.repeat(64), VPS_HOST: 'host.example', VPS_USER: 'root',
};
const url = 'https://artifact.example/file.zip?signature=private';
const redirect = () => new Response(null, { status: 302, headers: { location: url } });
const sshResult = (status: number) => ({ status, pid: 1, output: [], stdout: null, stderr: null, signal: null });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('Hono artifact pull', () => {
  test('token 仅用于 runner API，临时链接通过 SSH stdin 传递', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect());
    vi.stubGlobal('fetch', fetch);
    vi.mocked(spawnSync).mockReturnValue(sshResult(0));
    await pullHonoArtifact(env);
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo/actions/artifacts/123/zip', expect.objectContaining({ redirect: 'manual' }));
    const [, args, options] = vi.mocked(spawnSync).mock.calls[0];
    expect(JSON.stringify(args)).not.toContain(url);
    expect(JSON.stringify([args, options])).not.toContain(env.GITHUB_TOKEN);
    expect(JSON.parse(options!.input as string)).toEqual({ url, digest: env.ARTIFACT_DIGEST, release_id: env.RELEASE_ID });
  });

  test('下载过期后重新请求 URL，而非重试部署', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect());
    vi.stubGlobal('fetch', fetch);
    vi.mocked(spawnSync).mockReturnValueOnce(sshResult(42)).mockReturnValueOnce(sshResult(0));
    await pullHonoArtifact(env);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  test('校验失败立即停止，不再拉取', async () => {
    const fetch = vi.fn().mockResolvedValue(redirect());
    vi.stubGlobal('fetch', fetch);
    vi.mocked(spawnSync).mockReturnValue(sshResult(1));
    await expect(pullHonoArtifact(env)).rejects.toThrow('未执行部署');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('下载失败最多三次，不无限等待', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect()));
    vi.mocked(spawnSync).mockReturnValue(sshResult(42));
    await expect(pullHonoArtifact(env)).rejects.toThrow('未执行部署');
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  test('无效摘要、权限不足或 HTTP 链接不建立 SSH', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(pullHonoArtifact({ ...env, ARTIFACT_DIGEST: '' })).rejects.toThrow('元数据');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(pullHonoArtifact(env)).rejects.toThrow('403');
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://unsafe.invalid' } }));
    await expect(pullHonoArtifact(env)).rejects.toThrow('HTTPS');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('SSH 使用的实际 shell 引号可执行，错误不泄露 stdin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect()));
    vi.mocked(spawnSync).mockReturnValue(sshResult(0));
    await pullHonoArtifact(env);
    const command = vi.mocked(spawnSync).mock.calls[0][1]!.at(-1)!;
    const { spawnSync: actualSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    // Invalid metadata must fail before touching any deployment directory.
    const result = actualSpawn('bash', ['-c', command], { input: JSON.stringify({ url }), encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('artifact 校验或安装失败，未执行部署');
    expect(result.stderr).not.toContain('signature');
    expect(result.stderr).not.toContain('SyntaxError');
  });

  test('远端 receiver 本地回归测试（不连接生产）', async () => {
    const { spawnSync: actualSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const result = actualSpawn('python3', ['-B', resolve('tests/hono-artifact-receive.test.py')], { encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
