import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { inspectReleaseSource, prepareDesktopRelease, validateReleaseConfig, validateSignature } from '../scripts/prepare-desktop-release.mjs';

const scratch: string[] = [];
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64');
// 仅结构测试向量，故意不是签名密钥或可验签安装包。
const signaturePacket = Buffer.alloc(74);
signaturePacket.write('ED');
const makeSignature = (version = '0.1.0') => b64(`untrusted comment: test only\n${b64(signaturePacket)}\ntrusted comment: timestamp:1793023744\tfile:test.exe\tversion:${version}\n${b64(Buffer.alloc(64))}\n`);
const signature = makeSignature();
const publicPacket = Buffer.alloc(42);
publicPacket.write('Ed');
const pubkey = b64(`untrusted comment: test only\n${b64(publicPacket)}\n`);

function config(version = '0.1.0', channel = 'stable') {
  return {
    version, channel, commit: 'a'.repeat(40), packageJson: { version },
    tauriConfig: {
      version, identifier: 'me.colanns.mahoshojo.desktop', productName: 'MahoShojo Generator',
      bundle: { targets: ['nsis'], createUpdaterArtifacts: true, windows: { nsis: { installMode: 'currentUser' } } },
      plugins: { updater: { pubkey, requireSignedVersion: true, endpoints: [`https://mahoshojo.colanns.me/desktop/updates/${channel}/latest.json`] } },
    },
    cargoToml: `[package]\nname = "mahoshojo-desktop"\nversion = "${version}"\n`,
    cargoLock: `[[package]]\nname = "mahoshojo-desktop"\nversion = "${version}"\n`,
  };
}

function git(repoRoot: string, args: string[]) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function fixture(version = '0.1.0', channel = 'stable') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-release-test-'));
  scratch.push(root);
  const repoRoot = path.join(root, 'repo');
  const app = path.join(repoRoot, 'apps/desktop');
  await mkdir(path.join(app, 'src-tauri'), { recursive: true });
  const cfg = config(version, channel);
  await Promise.all([
    writeFile(path.join(app, 'package.json'), JSON.stringify(cfg.packageJson)),
    writeFile(path.join(app, 'src-tauri/tauri.conf.json'), JSON.stringify(cfg.tauriConfig)),
    writeFile(path.join(app, 'src-tauri/Cargo.toml'), cfg.cargoToml),
    writeFile(path.join(app, 'src-tauri/Cargo.lock'), cfg.cargoLock),
    writeFile(path.join(repoRoot, 'notes.md'), '# 发行说明\n\n测试候选。\n'),
  ]);
  git(repoRoot, ['init']);
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const bundleDir = path.join(root, 'bundle');
  await mkdir(bundleDir);
  const installerName = `MahoShojo Generator_${version}_x64-setup.exe`;
  const installer = Buffer.from('MZ-synthetic-installer-envelope-test');
  await writeFile(path.join(bundleDir, installerName), installer);
  await writeFile(path.join(bundleDir, `${installerName}.sig`), `${makeSignature(version)}\n`);
  return { repoRoot, version, channel, commit: git(repoRoot, ['rev-parse', 'HEAD']), bundleDir,
    outputDir: path.join(root, 'candidate'), notesFile: path.join(repoRoot, 'notes.md'), installerName, installer };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('desktop candidate source gates', () => {
  test.each([
    ['0.1.0-beta.1', 'stable'], ['0.1.0-alpha.1', 'rc'], ['0.1.0-rc.1', 'stable'], ['0.1.0', 'rc'],
    ['01.1.0', 'stable'], ['0.1.0-rc.0', 'rc'], ['0.1.0+build', 'stable'],
  ])('rejects invalid version/channel %s %s', (version, channel) => {
    expect(() => validateReleaseConfig(config(version, channel))).toThrow('通道');
  });

  test('accepts isolated RC endpoint and tag', () => {
    expect(validateReleaseConfig(config('0.1.0-rc.1', 'rc'))).toEqual({
      tag: 'desktop-v0.1.0-rc.1', endpoint: 'https://mahoshojo.colanns.me/desktop/updates/rc/latest.json',
    });
  });

  test('rejects version drift, disabled updater, channel crossover and missing public key', () => {
    const drift = config();
    drift.packageJson.version = '0.1.1';
    expect(() => validateReleaseConfig(drift)).toThrow('版本');
    const disabled = config();
    disabled.tauriConfig.bundle.createUpdaterArtifacts = false;
    expect(() => validateReleaseConfig(disabled)).toThrow('配置');
    const crossover = config('0.1.0-rc.1', 'rc');
    crossover.tauriConfig.plugins.updater.endpoints = config().tauriConfig.plugins.updater.endpoints;
    expect(() => validateReleaseConfig(crossover)).toThrow('当前通道');
    const missingKey = config();
    missingKey.tauriConfig.plugins.updater.pubkey = '';
    expect(() => validateReleaseConfig(missingKey)).toThrow('pubkey');
    const unboundVersion = config();
    unboundVersion.tauriConfig.plugins.updater.requireSignedVersion = false;
    expect(() => validateReleaseConfig(unboundVersion)).toThrow('requireSignedVersion');
  });

  test('binds the actual HEAD and refuses dirty source', async () => {
    const args = await fixture();
    await expect(inspectReleaseSource({ ...args, commit: 'a'.repeat(40) })).rejects.toThrow('HEAD');
    await writeFile(args.notesFile, 'modified');
    await expect(inspectReleaseSource(args)).rejects.toThrow('未提交');
  });

  test('refuses untracked source that could be included by the build', async () => {
    const args = await fixture();
    await writeFile(path.join(args.repoRoot, 'apps/desktop/injected.ts'), 'export const untracked = true;');
    await expect(inspectReleaseSource(args)).rejects.toThrow('未跟踪');
  });
});

describe('desktop release staging', () => {
  test.each([['0.1.0', 'stable'], ['0.1.0-rc.1', 'rc']])('stages same bytes, checksums and exact encoded URL for %s', async (version, channel) => {
    const args = await fixture(version, channel);
    const result = await prepareDesktopRelease(args);
    expect(result.installer.sha256).toBe(createHash('sha256').update(args.installer).digest('hex'));
    expect(await readFile(path.join(args.outputDir, args.installerName))).toEqual(args.installer);
    const manifest = JSON.parse(await readFile(path.join(args.outputDir, 'latest.json'), 'utf8'));
    expect(manifest).toEqual({ version, notes: '# 发行说明\n\n测试候选。', platforms: { 'windows-x86_64': {
      signature: makeSignature(version), url: `https://github.com/RunoreLab/MahoShojo-Generator/releases/download/desktop-v${version}/${encodeURIComponent(args.installerName)}`,
    } } });
    const metadata = JSON.parse(await readFile(path.join(args.outputDir, 'release-metadata.json'), 'utf8'));
    expect(metadata).toMatchObject({ commit: args.commit, channel, state: 'candidate-not-published' });
    expect(metadata.signatureVerification).toContain('envelope-only');
    const sums = await readFile(path.join(args.outputDir, 'SHA256SUMS.txt'), 'utf8');
    for (const line of sums.trim().split('\n')) {
      const [hash, name] = line.split('  ');
      expect(createHash('sha256').update(await readFile(path.join(args.outputDir, name))).digest('hex')).toBe(hash);
    }
    expect(await readdir(args.outputDir)).toHaveLength(6);
    await expect(prepareDesktopRelease(args)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(args.outputDir, args.installerName))).toEqual(args.installer);
  });

  test.each(['missing-signature', 'empty-installer', 'wrong-version', 'extra-installer', 'malformed-signature', 'wrong-signed-version'])('rejects incomplete/ambiguous bundle: %s', async (fault) => {
    const args = await fixture();
    if (fault === 'missing-signature') await rm(path.join(args.bundleDir, `${args.installerName}.sig`));
    if (fault === 'empty-installer') await writeFile(path.join(args.bundleDir, args.installerName), '');
    if (fault === 'wrong-version') {
      await rm(path.join(args.bundleDir, args.installerName));
      await writeFile(path.join(args.bundleDir, 'MahoShojo Generator_0.1.1_x64-setup.exe'), args.installer);
    }
    if (fault === 'extra-installer') await writeFile(path.join(args.bundleDir, 'other.exe'), args.installer);
    if (fault === 'malformed-signature') await writeFile(path.join(args.bundleDir, `${args.installerName}.sig`), 'https://example.invalid/signature');
    if (fault === 'wrong-signed-version') await writeFile(path.join(args.bundleDir, `${args.installerName}.sig`), makeSignature('0.0.9'));
    await expect(prepareDesktopRelease(args)).rejects.toThrow();
    await expect(readdir(args.outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('refuses untracked release notes', async () => {
    const args = await fixture();
    const notesFile = path.join(args.repoRoot, 'private.md');
    await writeFile(notesFile, 'unreviewed notes');
    await expect(prepareDesktopRelease({ ...args, notesFile })).rejects.toThrow();
  });

  test('signature structure checks never claim cryptographic validation', () => {
    expect(validateSignature(signature, { pubkey, version: '0.1.0' })).toBe(signature);
    expect(() => validateSignature(b64('not a signature'), { pubkey, version: '0.1.0' })).toThrow('信封');
  });

  test('rejects a signature key ID not matching the configured public key', () => {
    const otherPacket = Buffer.from(publicPacket);
    otherPacket[2] = 1;
    const otherKey = b64(`untrusted comment: test only\n${b64(otherPacket)}\n`);
    expect(() => validateSignature(signature, { pubkey: otherKey, version: '0.1.0' })).toThrow('key ID');
  });

  test.each(['0.1.1', '0.1.0\tversion:0.1.0', ''])('rejects wrong or ambiguous trusted version %s', (version) => {
    expect(() => validateSignature(makeSignature(version), { pubkey, version: '0.1.0' })).toThrow('候选版本');
  });

  test('accepts a captured real Tauri CLI 2.12 signature envelope and public key', () => {
    // 公开测试样本来自独立文本 probe，只保留公钥与签名；不含私钥，不做密码学验签。
    const realSignature = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRVmFGbEx0Q21HUmNaaS82ZE1SOU1vbUFYM3BmYS9ZNFVFbHQyRlduQVN4ekJSeTJLd3ZOSEZhZDNiZGljUVFtblp3eDFEanViM2U2VnIzVTdYNDF6Z21KL2k2TnhDUmdnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzMDIzNzQ0CWZpbGU6dXBkYXRlci1zaWduaW5nLXByb2JlLnR4dAl2ZXJzaW9uOjAuMS4wCkpvbFd2UzBCbCsvelBSVk9ReitUcGRLaXUwVVlmYUQ0b2Y5SXp5eVA0MFVvSy9HU21UZ29SdzRsNS8yQjZ5cUlENU45VmpKSk16ZXpPZFZWSUZKUUJRPT0K';
    const realPublicKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ1ODYyOUI0NEI1OTY4MTUKUldRVmFGbEx0Q21HUmNrYXBBVEdtSGRDT1BoUEVTWFlZekkxTmJpVmd3V09NRUNqN0xoVHQ5NWUK';
    expect(validateSignature(realSignature, { pubkey: realPublicKey, version: '0.1.0' })).toBe(realSignature);
    expect(() => validateSignature(realSignature, { pubkey: realPublicKey, version: '0.1.1' })).toThrow('候选版本');
  });
});
