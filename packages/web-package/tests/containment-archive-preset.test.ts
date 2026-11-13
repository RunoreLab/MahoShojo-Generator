import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  createWebPackageInstance,
  createWebPackageOverlay,
  packWebPackageZip,
  resolveWebPackage,
  unpackWebPackageZip,
} from '../src';
import { renderWebPackageInstance } from '../src/browser';

describe('存续院收容档案预设', () => {
  it('同一身份往返 ZIP，并以标准 JSON overlay 装配包内模块', async () => {
    const preset = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.id === 'continuance.cx-archive-package');
    expect(preset).toBeDefined();
    const base = await resolveWebPackage(preset!.packageRef);
    const imported = await unpackWebPackageZip(await packWebPackageZip(base));
    expect(imported.ref).toEqual(base.ref);
    const example = new TextDecoder().decode(imported.readFile(imported.manifest.generation.example!));
    const data = JSON.parse(example);
    const registry = JSON.parse(new TextDecoder().decode(imported.readFile('modules/registry.json')));
    for (const id of data.modules) {
      const module = registry.modules.find((entry: { id: string }) => entry.id === id);
      expect(module).toBeDefined();
      expect(imported.readFile(module.script)).toBeDefined();
    }
    const overlay = await createWebPackageOverlay(base.ref, example);
    const instance = await createWebPackageInstance(imported, overlay);
    expect(JSON.parse(new TextDecoder().decode(instance.readFile('data/archive.json')))).toEqual(data);
    expect((await renderWebPackageInstance(instance)).diagnostics).toEqual([]);
    expect(imported.manifest.files.every((file) => /^(?:text\/|application\/(?:json|javascript)$|image\/svg\+xml$)/u.test(file.mediaType))).toBe(true);
  });
});
