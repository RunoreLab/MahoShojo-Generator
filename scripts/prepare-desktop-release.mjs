import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPOSITORY = 'RunoreLab/MahoShojo-Generator';
const IDENTIFIER = 'me.colanns.mahoshojo.desktop';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/u;

function fail(message) {
  throw new Error(message);
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) || !value) {
    fail(`${label} 必须是完整的 base64 内容，不是路径或 URL`);
  }
  return Buffer.from(value, 'base64');
}

function publicKeyPacket(pubkey) {
  const lines = decodeBase64(pubkey, 'updater pubkey').toString('utf8').trim().split(/\r?\n/u);
  const packet = lines.length === 2 && decodeBase64(lines[1], 'public key packet');
  if (!lines[0].startsWith('untrusted comment: ') || !packet || packet.length !== 42
      || packet.subarray(0, 2).toString() !== 'Ed') fail('updater pubkey 不是有效的 minisign 公钥信封');
  return packet;
}

// 这里只检查 Tauri/minisign 信封结构、key ID 与声明版本，不验证密码学关系。
// 正式验收必须使用真实 Updater 完成正确/错误签名与损坏包演练。
export function validateSignature(signature, { pubkey, version }) {
  const lines = decodeBase64(signature, 'updater signature').toString('utf8').trim().split(/\r?\n/u);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) {
    fail('updater signature 不是 Tauri minisign 信封');
  }
  const packet = decodeBase64(lines[1], 'signature packet');
  if (packet.length !== 74 || !['Ed', 'ED'].includes(packet.subarray(0, 2).toString()) || decodeBase64(lines[3], 'global signature').length !== 64) {
    fail('updater signature 长度或算法标记错误');
  }
  if (!packet.subarray(2, 10).equals(publicKeyPacket(pubkey).subarray(2, 10))) {
    fail('updater signature key ID 与候选配置公钥不一致');
  }
  // Tauri CLI 2.12 在 trusted comment 的 tab 分隔字段中加入 version。
  // 客户端 requireSignedVersion 会在密码学验签后核对它与更新清单的版本。
  const signedVersions = lines[2].slice('trusted comment: '.length).split('\t')
    .filter((field) => field.startsWith('version:')).map((field) => field.slice('version:'.length));
  if (signedVersions.length !== 1 || signedVersions[0] !== version) {
    fail('updater signature trusted comment 必须且只能声明一次候选版本');
  }
  return signature;
}

export function validateReleaseConfig({ version, channel, commit, packageJson, tauriConfig, cargoToml, cargoLock }) {
  const match = typeof version === 'string' && version.match(VERSION);
  if (!match || !['stable', 'rc'].includes(channel) || (channel === 'rc') !== Boolean(match[4])) {
    fail('只允许 stable 的 x.y.z 或 rc 的 x.y.z-rc.N，禁止混用通道');
  }
  if (!/^[a-f0-9]{40}$/u.test(commit ?? '')) fail('commit 必须是完整的 40 位 Git SHA');
  const crateVersion = cargoToml.match(/\[package\][^[]*?^version\s*=\s*"([^"]+)"/mu)?.[1];
  const lockVersion = cargoLock.match(/\[\[package\]\][^[]*?name = "mahoshojo-desktop"[^[]*?^version\s*=\s*"([^"]+)"/mu)?.[1];
  if ([packageJson.version, tauriConfig.version, crateVersion, lockVersion].some((value) => value !== version)) {
    fail('Desktop package/config/Cargo 版本必须与候选版本完全一致，请先 sync:desktop-version');
  }
  if (tauriConfig.identifier !== IDENTIFIER || tauriConfig.bundle?.createUpdaterArtifacts !== true
      || JSON.stringify(tauriConfig.bundle?.targets) !== JSON.stringify(['nsis'])
      || tauriConfig.bundle?.windows?.nsis?.installMode !== 'currentUser') {
    fail('候选必须保留应用标识、currentUser NSIS 与 v2 updater 产物配置');
  }
  const updater = tauriConfig.plugins?.updater;
  publicKeyPacket(updater?.pubkey);
  if (updater.requireSignedVersion !== true) fail('updater 必须启用 requireSignedVersion 防止版本声明与旧包错配');
  const endpoint = `https://mahoshojo.colanns.me/desktop/updates/${channel}/latest.json`;
  if (JSON.stringify(updater.endpoints) !== JSON.stringify([endpoint]) || updater.dangerousInsecureTransportProtocol === true) {
    fail(`候选 updater 必须仅使用当前通道 HTTPS 地址：${endpoint}`);
  }
  return { tag: `desktop-v${version}`, endpoint };
}

async function readRegularFile(filename, { maxSize = Infinity } = {}) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size === 0 || stat.size > maxSize) fail(`必须为非空、有界普通文件：${path.basename(filename)}`);
  return readFile(filename);
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function inspectReleaseSource({ repoRoot, version, channel, commit }) {
  const [packageText, configText, cargoToml, cargoLock] = await Promise.all([
    'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/src-tauri/Cargo.lock',
  ].map((name) => readFile(path.join(repoRoot, name), 'utf8')));
  const tauriConfig = JSON.parse(configText);
  const release = validateReleaseConfig({ version, channel, commit, packageJson: JSON.parse(packageText), tauriConfig, cargoToml, cargoLock });
  if (git(repoRoot, ['rev-parse', 'HEAD']) !== commit) fail('commit 与实际 checkout HEAD 不一致');
  if (git(repoRoot, ['status', '--porcelain', '--untracked-files=all'])) fail('候选源码包含未提交修改或未跟踪文件');
  return { ...release, productName: tauriConfig.productName, pubkey: tauriConfig.plugins.updater.pubkey };
}

export async function prepareDesktopRelease(options) {
  const { repoRoot, version, channel, commit, bundleDir, outputDir, notesFile } = options;
  const { tag, endpoint, productName, pubkey } = await inspectReleaseSource(options);
  // Notes 必须来自同一提交，不能把维护者机器上的临时文件混入发行记录。
  const notesRelative = path.relative(repoRoot, path.resolve(notesFile)).split(path.sep).join('/');
  if (notesRelative.startsWith('../') || path.isAbsolute(notesRelative)) fail('release notes 必须位于仓库内');
  git(repoRoot, ['ls-files', '--error-unmatch', '--', notesRelative]);
  const notes = (await readRegularFile(notesFile, { maxSize: 128 * 1024 })).toString('utf8').trim();
  if (!notes) fail('release notes 不能为空');
  const installerName = `${productName}_${version}_x64-setup.exe`;
  if (path.basename(installerName) !== installerName || /[\r\n\\/]/u.test(installerName)) fail('安装包文件名非法');
  const files = await readdir(bundleDir);
  const installers = files.filter((name) => name.endsWith('.exe'));
  if (installers.length !== 1 || installers[0] !== installerName) fail('bundle 目录必须只有一个与版本匹配的 Windows x64 NSIS 安装包');
  const installer = await readRegularFile(path.join(bundleDir, installerName));
  if (installer.subarray(0, 2).toString() !== 'MZ') fail('安装包缺少 Windows 可执行文件头');
  const signatureName = `${installerName}.sig`;
  const signatureBytes = await readRegularFile(path.join(bundleDir, signatureName), { maxSize: 16 * 1024 });
  const signature = validateSignature(signatureBytes.toString('utf8').trim(), { pubkey, version });
  // GitHub 可能重命名含空格的资产；归档时使用固定 ASCII 名称，签名字节保持不变。
  const publishedInstallerName = `MahoShojo-Generator_${version}_x64-setup.exe`;
  const url = `https://github.com/${REPOSITORY}/releases/download/${tag}/${publishedInstallerName}`;
  const manifest = { version, notes, platforms: { 'windows-x86_64': { signature, url } } };
  const assets = new Map([
    [publishedInstallerName, installer], [`${publishedInstallerName}.sig`, signatureBytes],
    ['latest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['RELEASE_NOTES.md', Buffer.from(`${notes}\n`)],
  ]);
  const checksums = [...assets].map(([name, bytes]) => ({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  assets.set('release-metadata.json', Buffer.from(`${JSON.stringify({
    schemaVersion: 1, repository: REPOSITORY, commit, version, tag, channel, endpoint,
    state: 'candidate-not-published', signatureVerification: 'envelope-only; real updater acceptance required', assets: checksums,
  }, null, 2)}\n`));
  assets.set('SHA256SUMS.txt', Buffer.from([...assets].map(([name, bytes]) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`).join('')));
  // 不接受现存目录（包括空目录），避免重跑或部分失败悄悄覆盖验收对象。
  await mkdir(outputDir, { recursive: false });
  for (const [name, bytes] of assets) await writeFile(path.join(outputDir, name), bytes, { flag: 'wx' });
  return { version, tag, channel, commit, installer: checksums[0], outputDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    version: { type: 'string' }, channel: { type: 'string' }, commit: { type: 'string' },
    'bundle-dir': { type: 'string' }, 'output-dir': { type: 'string' }, 'notes-file': { type: 'string' },
    'check-source': { type: 'boolean', default: false },
  } });
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const options = { repoRoot, version: values.version, channel: values.channel, commit: values.commit };
  if (values['check-source']) {
    console.log(JSON.stringify(await inspectReleaseSource(options), null, 2));
  } else {
    for (const name of ['bundle-dir', 'output-dir', 'notes-file']) if (!values[name]) fail(`缺少 --${name}`);
    console.log(JSON.stringify(await prepareDesktopRelease({ ...options,
      bundleDir: path.resolve(values['bundle-dir']), outputDir: path.resolve(values['output-dir']), notesFile: path.resolve(values['notes-file']),
    }), null, 2));
  }
}
