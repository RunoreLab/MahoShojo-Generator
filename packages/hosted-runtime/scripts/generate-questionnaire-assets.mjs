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
const assets = Object.fromEntries(entries.map((entry) => {
  const publicPath = typeof entry?.path === 'string' ? entry.path : '';
  if (!publicPath.startsWith('/questionnaires/presets/') || publicPath.includes('..')) {
    throw new Error(`非法 questionnaire preset path: ${publicPath}`);
  }
  return [publicPath, JSON.parse(readFileSync(path.join(publicDirectory, publicPath), 'utf8'))];
}));

const source = `// 此文件由 scripts/generate-questionnaire-assets.mjs 生成，请勿手工编辑。\n`
  + `export const QUESTIONNAIRE_PRESET_ASSETS: Readonly<Record<string, unknown>> = Object.freeze(${JSON.stringify(assets)});\n`;

if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== source) {
    throw new Error('questionnaire preset 生成资产已过期，请运行 pnpm assets:questionnaires');
  }
  process.exit(0);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source, 'utf8');
