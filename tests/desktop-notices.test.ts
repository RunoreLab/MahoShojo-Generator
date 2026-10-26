import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { buildNpmNotices, buildRustNotices, collectLicenseTexts } from '../scripts/generate-desktop-notices.mjs';

const roots: string[] = [];
async function scratch() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-notices-'));
  roots.push(directory);
  return directory;
}

async function npmPackage(root: string, name: string, files: Record<string, string>, version = '1.2.3') {
  const directory = path.join(root, name.replace('/', '-'));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version, repository: { url: 'git+https://example.org/project.git' } }));
  for (const [filename, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, filename)), { recursive: true });
    await writeFile(path.join(directory, filename), text);
  }
  return directory;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Desktop third-party notices', () => {
  test('preserves copyright and package notices without exposing local paths', async () => {
    const root = await scratch();
    const directory = await npmPackage(root, 'font-package', {
      LICENSE: 'MIT License\r\nCopyright (c) 2026 Font Author\r\nPermission text.\r\n',
      NOTICE: 'Font attribution must be kept.\n',
      'licenses/fonts/OFL.txt': 'Font license text.\n',
      'src/LICENSE': 'A fixture that must not be traversed.\n',
    });
    const result = await buildNpmNotices({ MIT: [{ name: 'font-package', license: 'MIT', paths: [directory] }] }, { fallbacks: {} });
    expect(result.count).toBe(1);
    expect(result.missing).toEqual([]);
    expect(result.text).toContain('font-package@1.2.3');
    expect(result.text).toContain('Copyright (c) 2026 Font Author\nPermission text.');
    expect(result.text).toContain('Font attribution must be kept.');
    expect(result.text).toContain('Font license text.');
    expect(result.text).not.toContain('fixture that must not');
    expect(result.text).not.toContain(root);
    expect(result.text).not.toContain(directory);
    expect(result.text).toContain('Source: https://example.org/project.git');
  });

  test('uses recorded official fallback only when package license files are absent', async () => {
    const root = await scratch();
    const fallbackDirectory = path.join(root, 'fallback');
    await mkdir(fallbackDirectory);
    await writeFile(path.join(fallbackDirectory, 'author-LICENSE.txt'), 'MIT License\nCopyright Original Author\n');
    const a = await npmPackage(root, 'missing-license', {});
    const b = await npmPackage(root, 'bundled-license', { LICENSE: 'Bundled license is authoritative.' });
    const fallback = { files: ['author-LICENSE.txt'], source: 'https://example.org/LICENSE' };
    const result = await buildNpmNotices({ MIT: [
      { license: 'MIT', paths: [a] }, { license: 'MIT', paths: [b] },
    ] }, { fallbackDirectory, fallbacks: { 'missing-license': fallback, 'bundled-license': fallback } });
    expect(result.text).toContain('License text source: https://example.org/LICENSE');
    expect(result.text.match(/Copyright Original Author/gu)).toHaveLength(1);
    expect(result.text).toContain('Bundled license is authoritative.');
    expect(result.missing).toEqual([]);
  });

  test('reports exact package/version for missing license text and deduplicates installs', async () => {
    const root = await scratch();
    const a = await npmPackage(root, 'needs-review', {});
    const result = await buildNpmNotices({ MIT: [{ license: 'MIT', paths: [a, a] }] }, { fallbacks: {} });
    expect(result.count).toBe(1);
    expect(result.missing).toEqual(['needs-review@1.2.3']);
    expect(result.text).toContain('Missing license texts:\n- needs-review@1.2.3');
    expect(result.text).not.toContain(root);
  });

  test('uses Cargo resolved target graph, excludes workspace and honors license_file', async () => {
    const root = await scratch();
    const crate = await npmPackage(root, 'a-crate', { 'legal/custom.txt': 'Copyright Crate Author\nCustom grant.' });
    const packages = [
      { id: 'root', name: 'my-app', version: '0.1.0', manifest_path: path.join(root, 'not-opened') },
      { id: 'target-dependency', name: 'a-crate', version: '2.0.0', license: 'MIT', license_file: 'legal/custom.txt', repository: 'https://example.org/crate', manifest_path: path.join(crate, 'Cargo.toml') },
      { id: 'other-platform', name: 'not-for-windows', version: '1.0.0', manifest_path: path.join(root, 'not-opened-either') },
    ];
    const result = await buildRustNotices({ packages, workspace_members: ['root'], resolve: { nodes: [{ id: 'root' }, { id: 'target-dependency' }] } });
    expect(result.count).toBe(1);
    expect(result.missing).toEqual([]);
    expect(result.text).toContain('a-crate@2.0.0');
    expect(result.text).toContain('Copyright Crate Author\nCustom grant.');
    expect(result.text).toContain('Includes build and development dependencies');
    expect(result.text).not.toContain(root);
    expect(result.text).not.toContain('not-for-windows');
  });

  test('explicit license_file cannot read outside the dependency directory', async () => {
    const root = await scratch();
    const directory = await npmPackage(root, 'a-package', {});
    await writeFile(path.join(root, 'private.txt'), 'Must not be packaged.');
    expect(await collectLicenseTexts(directory, '../private.txt')).toEqual([]);
  });

  test('a missing declared Cargo license file is reported by package name instead of failing on its local path', async () => {
    const root = await scratch();
    const crate = await npmPackage(root, 'missing-crate', {});
    const result = await buildRustNotices({
      packages: [{ id: 'crate', name: 'missing-crate', version: '3.0.0', license: 'MIT', license_file: 'not-in-published-crate.txt', manifest_path: path.join(crate, 'Cargo.toml') }],
      workspace_members: [], resolve: { nodes: [{ id: 'crate' }] },
    });
    expect(result.missing).toEqual(['missing-crate@3.0.0']);
    expect(result.text).toContain('Source: https://crates.io/crates/missing-crate/3.0.0');
    expect(result.text).not.toContain(root);
  });

  test('Cargo fallback is tied to the exact published version and preserves original copyright', async () => {
    const root = await scratch();
    const crate = await npmPackage(root, 'fallback-crate', {});
    await writeFile(path.join(root, 'upstream-LICENSE.txt'), 'MIT License\nCopyright Original Crate Author\n');
    const packages = ['1.0.0', '2.0.0'].map((version) => ({
      id: version, name: 'fallback-crate', version, license: 'MIT', manifest_path: path.join(crate, 'Cargo.toml'),
    }));
    const result = await buildRustNotices({ packages, workspace_members: [], resolve: { nodes: packages } }, {
      fallbackDirectory: root,
      fallbacks: { 'fallback-crate@1.0.0': { files: ['upstream-LICENSE.txt'], source: 'https://example.org/commit/LICENSE' } },
    });
    expect(result.missing).toEqual(['fallback-crate@2.0.0']);
    expect(result.text).toContain('Copyright Original Crate Author');
    expect(result.text).toContain('Source: https://crates.io/crates/fallback-crate/1.0.0');
    expect(result.text).not.toContain(root);
  });
});
