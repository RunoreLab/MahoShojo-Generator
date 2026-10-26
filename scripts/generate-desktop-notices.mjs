import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FALLBACK_DIRECTORY = path.join(REPO_ROOT, 'apps/desktop/licenses');
const LICENSE_NAME = /^(?:licen[sc]e|copying|copyright|notice)(?:[._-].*)?$/iu;
const LICENSE_DIRECTORY = /^(?:licen[sc]es?|notices?)$/iu;
const THIRD_PARTY_NAME = /^third[._-]party.*(?:licen[sc]es?|notices?)(?:[._-].*)?$/iu;

function publicSource(...values) {
  for (const value of values) {
    const raw = typeof value === 'string' ? value : value?.url;
    if (!raw) continue;
    try {
      const url = new URL(raw.replace(/^git\+/u, ''));
      if (['https:', 'http:'].includes(url.protocol)) return url.href;
    } catch { /* A local manifest path is not a source URL. */ }
  }
  return '';
}

async function readText(filename) {
  const details = await stat(filename).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!details) return null;
  if (!details.isFile() || details.size > 1024 * 1024) return null;
  const text = await readFile(filename, 'utf8');
  return text.trim() ? text.replace(/\r\n/gu, '\n').trimEnd() : null;
}

/** Collect root notices and small dedicated license directories, never a package's source tree. */
export async function collectLicenseTexts(directory, explicitFile) {
  const files = new Set();
  const root = path.resolve(directory);
  if (explicitFile) {
    const filename = path.resolve(root, explicitFile);
    const relative = path.relative(root, filename);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) files.add(filename);
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && (LICENSE_NAME.test(entry.name) || THIRD_PARTY_NAME.test(entry.name))) {
      files.add(path.join(root, entry.name));
    } else if (entry.isDirectory() && LICENSE_DIRECTORY.test(entry.name)) {
      const folder = path.join(root, entry.name);
      for (const child of await readdir(folder, { withFileTypes: true })) {
        if (child.isFile()) files.add(path.join(folder, child.name));
        // Some crates group individual SPDX texts one directory below LICENSES.
        else if (child.isDirectory()) {
          for (const leaf of await readdir(path.join(folder, child.name), { withFileTypes: true })) {
            if (leaf.isFile()) files.add(path.join(folder, child.name, leaf.name));
          }
        }
      }
    }
  }
  const texts = [];
  for (const filename of [...files].sort()) {
    const text = await readText(filename);
    if (text) texts.push({ name: path.relative(root, filename).split(path.sep).join('/'), text });
  }
  return texts;
}

function renderNotices(title, scope, packages) {
  const entries = packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  const missing = entries.filter((entry) => entry.texts.length === 0).map((entry) => `${entry.name}@${entry.version}`);
  const sections = entries.map((entry) => [
    '='.repeat(72), `${entry.name}@${entry.version}`, `License: ${entry.license || 'not declared'}`,
    `Source: ${entry.source}`, ...(entry.fallbackSource ? [`License text source: ${entry.fallbackSource}`] : []), '',
    ...(entry.texts.length ? entry.texts.flatMap(({ name, text }) => [`--- ${name} ---`, text, '']) : ['MISSING LICENSE TEXT', '']),
  ].join('\n'));
  return {
    count: entries.length,
    missing,
    text: [title, '', scope, '', `Packages: ${entries.length}`,
      ...(missing.length ? ['', 'Missing license texts:', ...missing.map((name) => `- ${name}`)] : []), '', ...sections, ''].join('\n'),
  };
}

export async function buildNpmNotices(licenseList, { fallbackDirectory = FALLBACK_DIRECTORY, fallbacks } = {}) {
  const fallbackMap = fallbacks ?? JSON.parse(await readFile(path.join(fallbackDirectory, 'sources.json'), 'utf8'));
  const entries = new Map();
  for (const record of Object.values(licenseList).flat()) {
    for (const directory of record.paths) {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      const name = manifest.name;
      const version = manifest.version;
      const key = `${name}@${version}`;
      if (entries.has(key)) continue;
      let texts = await collectLicenseTexts(directory);
      let fallbackSource;
      if (texts.length === 0 && fallbackMap[name]) {
        const fallback = fallbackMap[name];
        fallbackSource = publicSource(fallback.source);
        texts = await Promise.all(fallback.files.map(async (filename) => ({
          name: filename, text: await readText(path.join(fallbackDirectory, filename)),
        })));
        texts = texts.filter(({ text }) => text);
      }
      entries.set(key, { name, version, license: record.license,
        source: publicSource(manifest.repository, manifest.homepage, record.homepage, `https://www.npmjs.com/package/${name}/v/${version}`),
        fallbackSource, texts });
    }
  }
  return renderNotices('MahoShojo Generator — JavaScript third-party notices',
    'Conservative inventory of production dependencies in the Desktop workspace dependency closure. Includes package license and notice texts, including bundled font notices when supplied. Some listed modules may be removed by bundling.',
    [...entries.values()]);
}

export async function buildRustNotices(metadata, { fallbackDirectory = FALLBACK_DIRECTORY, fallbacks } = {}) {
  const fallbackMap = fallbacks ?? JSON.parse(await readFile(path.join(fallbackDirectory, 'rust-sources.json'), 'utf8'));
  const included = new Set(metadata.resolve?.nodes.map(({ id }) => id) ?? []);
  const workspace = new Set(metadata.workspace_members);
  const packages = metadata.packages.filter(({ id }) => included.has(id) && !workspace.has(id));
  const entries = await Promise.all(packages.map(async (pkg) => {
    let texts = await collectLicenseTexts(path.dirname(pkg.manifest_path), pkg.license_file);
    const fallback = fallbackMap[`${pkg.name}@${pkg.version}`];
    let fallbackSource;
    if (texts.length === 0 && fallback) {
      fallbackSource = publicSource(fallback.source);
      texts = await Promise.all(fallback.files.map(async (filename) => ({
        name: filename, text: await readText(path.join(fallbackDirectory, filename)),
      })));
      texts = texts.filter(({ text }) => text);
    }
    return {
      name: pkg.name, version: pkg.version, license: pkg.license,
      // This versioned page provides the corresponding published crate source.
      source: `https://crates.io/crates/${pkg.name}/${pkg.version}`,
      fallbackSource, texts,
    };
  }));
  return renderNotices('MahoShojo Generator — Rust third-party notices',
    'Conservative Cargo dependency inventory for x86_64-pc-windows-msvc. Includes build and development dependencies in the resolved graph; this is not a claim that every crate is linked into the distributed binary.', entries);
}

function commandJson(command, args) {
  const options = { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] };
  // pnpm.cmd cannot be launched directly with execFile on Windows; all arguments here are fixed literals.
  const result = command === 'pnpm' && process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], options)
    : execFileSync(command, args, options);
  return JSON.parse(result);
}

export async function generateNotices({ rust = false } = {}) {
  const output = path.join(REPO_ROOT, 'apps/desktop/public');
  const npm = await buildNpmNotices(commandJson('pnpm', ['--filter', '@mahoshojo/desktop...', 'licenses', 'list', '--prod', '--json']));
  const results = [['THIRD_PARTY_NOTICES.txt', npm]];
  if (rust) {
    const metadata = commandJson('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml']);
    results.push(['RUST_THIRD_PARTY_NOTICES.txt', await buildRustNotices(metadata)]);
  }
  await mkdir(output, { recursive: true });
  for (const [name, result] of results) {
    await writeFile(path.join(output, name), result.text, 'utf8');
    console.log(`${name}: ${result.count} packages, ${result.missing.length} missing license texts`);
    if (result.missing.length) console.error(result.missing.join('\n'));
  }
  return results.some(([, result]) => result.missing.length > 0) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--rust')) throw new Error('Usage: node scripts/generate-desktop-notices.mjs [--rust]');
  process.exitCode = await generateNotices({ rust: args.includes('--rust') });
}
