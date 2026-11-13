import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUILTIN_WEB_PACKAGE_PRESETS,
  buildWebPackagePromptProjection,
  createWebPackageInstance,
  createWebPackageOverlay,
  packWebPackageZip,
  resolveWebPackage,
  unpackWebPackageZip,
  type ResolvedWebPackage,
} from '../src';
import { renderWebPackageInstance } from '../src/browser';

describe('恋爱测评预设的生成数据契约', () => {
  let base: ResolvedWebPackage;
  let example: string;
  beforeAll(async () => {
    const preset = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.id === 'creator.I_moly');
    expect(preset).toBeDefined();
    base = await resolveWebPackage(preset!.packageRef);
    example = new TextDecoder().decode(base.readFile(base.manifest.generation.example!));
  });

  it('以相同身份往返 ZIP，并通过标准 JSON overlay 与通用物化器运行', async () => {
    const imported = await unpackWebPackageZip(await packWebPackageZip(base));
    expect(imported.ref).toEqual(base.ref);
    const overlay = await createWebPackageOverlay(base.ref, example);
    const instance = await createWebPackageInstance(imported, overlay);
    expect(JSON.parse(new TextDecoder().decode(instance.readFile('data/report.json')))).toEqual(JSON.parse(example));
    expect((await renderWebPackageInstance(instance)).diagnostics).toEqual([]);
    expect(buildWebPackagePromptProjection(imported).target.mediaType).toBe('application/json');
  });

  it.each(['approach', 'defense', 'communication', 'complexity', 'volatility', 'rigidity'])(
    '拒绝漏掉 %s 并用另一维重复凑足六条的报告', async (id) => {
      const data = JSON.parse(example);
      const other = data.dimensions.find((item: { id: string }) => item.id !== id);
      data.dimensions.find((item: { id: string }) => item.id === id).id = other.id;
      await expect(createWebPackageOverlay(base.ref, JSON.stringify(data))).rejects.toThrow('JSON Schema');
    },
  );

  it('拒绝完全没有避雷建议、但条数及字段均合法的报告', async () => {
    const data = JSON.parse(example);
    for (const item of data.strategy) item.category = '切入';
    await expect(createWebPackageOverlay(base.ref, JSON.stringify(data))).rejects.toThrow('JSON Schema');
  });

  it('随预设分发的资源仅包含文本，排除页眉大图和备份文件', () => {
    expect(base.manifest.files.every((file) => /^(?:text\/|application\/(?:json|javascript)$)/u.test(file.mediaType))).toBe(true);
    expect(base.manifest.files.some((file) => file.path.endsWith('.bak'))).toBe(false);
  });
});
