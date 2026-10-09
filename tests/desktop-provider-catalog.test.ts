import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_PRESETS, AI_PROVIDER_MODEL_ALIASES, describeAiPresetModelDirectWire } from '../packages/ai-core/src/provider-catalog';

describe('native provider authority', () => {
  it('runs the real Node CLI with transitive TS schemas from any working directory', () => {
    expect(() => execFileSync(process.execPath, [
      fileURLToPath(new URL('../scripts/generate-desktop-provider-catalog.mjs', import.meta.url)),
      '--check',
    ], { cwd: tmpdir(), stdio: 'pipe' })).not.toThrow();
  });
  const native = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/src/generated/provider-presets.json', import.meta.url), 'utf8'));
  it('tracks every preset and its verified protocol exactly', () => {
    expect(native.map((entry: { id: string }) => entry.id)).toEqual(AI_PROVIDER_PRESETS.map((preset) => preset.id));
    for (const preset of AI_PROVIDER_PRESETS) {
      const entry = native.find((value: { id: string }) => value.id === preset.id);
      expect(entry.baseUrl).toBe(preset.baseUrl);
      expect(entry.providerType).toBe(preset.type);
      expect(entry.modelAliases).toEqual(AI_PROVIDER_MODEL_ALIASES[preset.id] ?? {});
      expect(entry.endpointKind).toBe(preset.endpointKind);
      expect(entry.models.map((model: { id: string }) => model.id)).toEqual(preset.models.map((model) => model.value));
      for (const model of [...preset.models, { value: 'not-a-catalog-model' }]) {
        const wire = describeAiPresetModelDirectWire(preset, model.value);
        const nativeAdapter = entry.models.find((value: { id: string }) => value.id === model.value)?.adapter ?? entry.adapter;
        const nativeSupports = entry.endpointKind === 'provider-public' && nativeAdapter === 'openai-compatible';
        expect(nativeSupports, `${preset.id}/${model.value}`).toBe(wire.status === 'verified' && wire.adapter === 'openai-compatible');
      }
    }
  });
});
