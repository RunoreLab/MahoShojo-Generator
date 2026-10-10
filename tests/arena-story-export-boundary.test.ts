import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const domain = path.join(root, 'packages/domain');
const manifest = JSON.parse(readFileSync(path.join(domain, 'package.json'), 'utf8'));

describe('story export shared leaf entrypoints', () => {
  it.each(['arena-story-export', 'arena-adjudication-markdown'])('%s is explicitly exported and browser-runtime independent', async (name) => {
    expect(manifest.exports[`./${name}`]).toBe(`./src/${name}.ts`);
    const bundled = await build({
      entryPoints: [path.join(domain, manifest.exports[`./${name}`])],
      bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
    });
    const sources = Object.keys(bundled.metafile!.inputs).map((file) => path.relative(root, path.resolve(file)));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((file) => file.startsWith('packages/domain/src/'))).toBe(true);
    expect(bundled.metafile!.outputs[Object.keys(bundled.metafile!.outputs)[0]].imports).toEqual([]);
  });
});
