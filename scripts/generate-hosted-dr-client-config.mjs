import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderHostedDrClientConfig } from './hosted-dr-client-config.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(
  path.join(repositoryRoot, 'config/hosted-dr-capabilities.json'),
  'utf8',
));
const stableOrigin = manifest?.controlPlane?.stableOrigin;
if (typeof stableOrigin !== 'string' || !stableOrigin) {
  throw new Error('Hosted DR manifest 缺少 stableOrigin');
}

const outputPath = path.join(
  repositoryRoot,
  'apps/web/config/hosted-dr-client.generated.ts',
);
await writeFile(outputPath, renderHostedDrClientConfig(stableOrigin), 'utf8');
console.log('Hosted DR client-safe config generated.');
