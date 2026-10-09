import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The catalog imports shared runtime schemas with bundler-style TS resolution.
// Bundle the real source in memory so this CLI uses the same dependency graph,
// without changing application import syntax or leaving generated JS on disk.
const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: [fileURLToPath(new URL('../packages/ai-core/src/provider-catalog.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { AI_PROVIDER_PRESETS, AI_PROVIDER_MODEL_ALIASES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

// This is derived executable authority, never a second hand-maintained provider catalog.
const output = new URL('../apps/desktop/src-tauri/src/generated/provider-presets.json', import.meta.url);
const entries = AI_PROVIDER_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  baseUrl: preset.baseUrl,
  providerType: preset.type,
  modelAliases: AI_PROVIDER_MODEL_ALIASES[preset.id] ?? {},
  endpointKind: preset.endpointKind,
  adapter: preset.direct?.adapter ?? null,
  models: preset.models.map((model) => ({
    id: model.value,
    adapter: model.direct === 'none' ? 'none' : model.direct?.adapter ?? null,
  })),
}));
for (const preset of entries) {
  const url = new URL(preset.baseUrl);
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/u.test(preset.id) || url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`Untrusted provider catalog entry: ${preset.id}`);
  }
}
if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('Duplicate preset identity');
const text = `${JSON.stringify(entries, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('Native provider catalog drift: run generate:desktop-provider-catalog');
} else await writeFile(output, text);
