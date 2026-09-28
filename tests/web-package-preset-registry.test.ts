import { mkdtemp, writeFile, mkdir, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compilePreset, generate } from '../scripts/generate-web-package-presets.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'web-package-preset-'));
  directories.push(directory);
  await writeFile(join(directory, 'web-package.json'), JSON.stringify({ format: 'mahoshojo-web-package', formatVersion: 1, id: 'fixture', version: '1', name: 'Fixture', entry: 'index.html', generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' } }));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Fixture</title>');
  return directory;
}
describe('directory authored Web Package presets', () => {
  it('committed compiled bytes match static sources and pinned identities', async () => {
    await generate({ check: true });
  });
  it('includes nested binary assets byte for byte and detects content changes', async () => {
    const directory = await fixture();
    await mkdir(join(directory, 'assets'));
    const bytes = Buffer.from([0, 255, 128, 10, 13]);
    await writeFile(join(directory, 'assets/image.png'), bytes);
    const first = await compilePreset(directory);
    expect(Buffer.from(first.files.find((file: { path: string }) => file.path === 'assets/image.png')!.base64, 'base64')).toEqual(bytes);
    expect(first.manifest.files.find((file: { path: string }) => file.path === 'assets/image.png')?.mediaType).toBe('image/png');
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Changed</title>');
    expect((await compilePreset(directory)).ref.digest).not.toBe(first.ref.digest);
  });
  it('rejects symlinks, including links escaping the package', async () => {
    const directory = await fixture();
    await symlink(join(directory, 'index.html'), join(directory, 'alias.html'));
    await expect(compilePreset(directory)).rejects.toThrow('Symlinks');
  });
  it('rejects case collisions and unknown media rather than silently losing assets', async () => {
    const directory = await fixture();
    await writeFile(join(directory, 'INDEX.html'), 'collision');
    await expect(compilePreset(directory)).rejects.toThrow('duplicate');
    await rm(join(directory, 'INDEX.html'));
    await writeFile(join(directory, 'unknown.bin'), 'unknown');
    await expect(compilePreset(directory)).rejects.toThrow('Unknown asset media type');
  });
  it('rejects manually maintained file tables in the authoring manifest', async () => {
    const directory = await fixture();
    const manifest = JSON.parse(await readFile(join(directory, 'web-package.json'), 'utf8'));
    await writeFile(join(directory, 'web-package.json'), JSON.stringify({ ...manifest, files: [] }));
    await expect(compilePreset(directory)).rejects.toThrow('must not enumerate');
  });
});
