import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Token stays on the runner. Only the short-lived URL and trusted build digests
// cross SSH stdin; none are interpolated into a remote shell command.
export async function pullHonoArtifact(env = process.env) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository,
    ARTIFACT_ID: artifactId, RELEASE_ID: releaseId, VPS_HOST: host, VPS_USER: user } = env;
  const digest = (env.ARTIFACT_DIGEST ?? '').replace(/^sha256:/u, '');
  if (!token || !/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '')
    || !/^\d+$/u.test(artifactId ?? '') || !/^[a-f0-9]{64}$/u.test(digest)
    || !/^[a-f0-9]{64}$/u.test(releaseId ?? '')
    || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(host ?? '')
    || !/^[a-z_][a-z0-9_-]*$/u.test(user ?? '')) {
    throw new Error('缺少或非法的 artifact / SSH 构建元数据');
  }
  const receiver = readFileSync(new URL('./receive-hono-artifact.py', import.meta.url), 'utf8');
  const command = `python3 -c '${receiver.replaceAll("'", "'\\''")}'`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = Date.now();
    console.info(`VPS 拉取 artifact：第 ${attempt}/3 次`);
    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      if (attempt < 3) continue;
      throw new Error('获取 artifact 下载链接超时或网络失败');
    }
    if (response.status !== 302) {
      if ((response.status === 429 || response.status >= 500) && attempt < 3) continue;
      throw new Error(`获取 artifact 下载链接失败：HTTP ${response.status}`);
    }
    const url = response.headers.get('location');
    if (!url || !URL.canParse(url) || new URL(url).protocol !== 'https:') {
      throw new Error('artifact 下载链接不是有效 HTTPS URL');
    }
    const result = spawnSync('ssh', [
      '-i', resolve(homedir(), '.ssh/deploy_key'),
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      `${user}@${host}`, command,
    ], {
      input: JSON.stringify({ url, digest, release_id: releaseId }),
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: 240_000,
    });
    if (result.status === 0) {
      console.info(`VPS artifact 准备完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return;
    }
    // Only retry downloads (42) or interrupted SSH (255). Integrity failures
    // fail closed; deployment itself is a separate, non-retried workflow step.
    if (![42, 255].includes(result.status) || attempt === 3) {
      throw new Error(`VPS 拉取失败，退出码 ${result.status ?? 'timeout'}；未执行部署`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  pullHonoArtifact().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
