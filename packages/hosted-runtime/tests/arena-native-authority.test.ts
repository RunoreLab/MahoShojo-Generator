import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { resolveArenaCombatantNativeAuthority } from '../src/arena-generation/native-authority';

const loadPreset = async (filename: string): Promise<Record<string, unknown>> => (
  JSON.parse(await readFile(
    new URL(`../../../apps/web/public/presets/${filename}`, import.meta.url),
    'utf8',
  )) as Record<string, unknown>
);

describe('Arena combatant native authority', () => {
  it('recognizes an exact server-owned character preset without trusting the client flag', async () => {
    const verifySignature = vi.fn(async () => false);

    await expect(resolveArenaCombatantNativeAuthority({
      type: 'character',
      filename: 'C01_egg.json',
      isNative: false,
      isPreset: true,
      data: await loadPreset('C01_egg.json'),
    }, verifySignature)).resolves.toBe(true);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it('fails closed for a renamed or modified unsigned preset', async () => {
    const original = await loadPreset('C01_egg.json');
    const verifySignature = vi.fn(async () => false);

    await expect(resolveArenaCombatantNativeAuthority({
      type: 'character',
      filename: 'renamed.json',
      isPreset: true,
      data: original,
    }, verifySignature)).resolves.toBe(false);
    await expect(resolveArenaCombatantNativeAuthority({
      type: 'character',
      filename: 'C01_egg.json',
      isPreset: true,
      data: { ...original, name: '篡改名称' },
    }, verifySignature)).resolves.toBe(false);
    expect(verifySignature).toHaveBeenCalledTimes(2);
  });

  it('continues to recognize signed custom cards', async () => {
    const verifySignature = vi.fn(async (value: unknown) => (
      (value as { signature?: unknown } | null)?.signature === 'valid'
    ));

    await expect(resolveArenaCombatantNativeAuthority({
      type: 'magical-girl',
      filename: 'custom.json',
      isPreset: false,
      data: { name: '自定义角色', signature: 'valid' },
    }, verifySignature)).resolves.toBe(true);
  });
});
