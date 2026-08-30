import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageDirectory, '..', '..');
const publicDirectory = path.join(repositoryRoot, 'apps', 'web', 'public');
const indexPath = path.join(publicDirectory, 'questionnaires', 'presets', 'index.json');
const outputPath = path.join(packageDirectory, 'src', 'generated', 'questionnaire-presets.ts');

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const entries = Array.isArray(index.presets) ? index.presets : [];
const semanticKeys = new Set();
const publicPaths = entries.map((entry) => {
  const id = typeof entry?.id === 'string' ? entry.id : '';
  const kind = typeof entry?.kind === 'string' ? entry.kind : '';
  const publicPath = typeof entry?.path === 'string' ? entry.path : '';
  if (!id || id !== id.trim()) {
    throw new Error(`questionnaire preset id 非 canonical: ${id}`);
  }
  if (kind !== 'magical-girl' && kind !== 'canshou') {
    throw new Error(`非法 questionnaire preset kind: ${kind}`);
  }
  if (
    publicPath !== publicPath.trim()
    || !publicPath.startsWith('/questionnaires/presets/')
    || !publicPath.endsWith('.json')
    || publicPath.includes('..')
  ) {
    throw new Error(`非法 questionnaire preset path: ${publicPath}`);
  }
  const semanticKey = `${kind}\0${id}`;
  if (semanticKeys.has(semanticKey)) {
    throw new Error(`questionnaire preset index 包含重复 kind/id: ${kind}/${id}`);
  }
  semanticKeys.add(semanticKey);
  return publicPath;
});
if (new Set(publicPaths).size !== publicPaths.length) {
  throw new Error('questionnaire preset index 包含重复 path');
}
const assets = Object.fromEntries(entries.map((entry, entryIndex) => {
  const publicPath = publicPaths[entryIndex];
  return [publicPath, JSON.parse(readFileSync(path.join(publicDirectory, publicPath), 'utf8'))];
}));
if (JSON.stringify(Object.keys(assets)) !== JSON.stringify(publicPaths)) {
  throw new Error('questionnaire preset index 与生成资产 path 不一致');
}

const source = `// 此文件由 scripts/generate-questionnaire-assets.mjs 生成，请勿手工编辑。\n`
  + `export const QUESTIONNAIRE_PRESET_INDEX = Object.freeze(${JSON.stringify(index)});\n`
  + `export const QUESTIONNAIRE_PRESET_ASSETS: Readonly<Record<string, unknown>> = Object.freeze(${JSON.stringify(assets)});\n`;

if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== source) {
    throw new Error('questionnaire preset 生成资产已过期，请运行 pnpm assets:questionnaires');
  }
  process.exit(0);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source, 'utf8');
