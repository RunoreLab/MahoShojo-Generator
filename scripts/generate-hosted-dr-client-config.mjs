import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderHostedDrClientConfig } from './hosted-dr-client-config.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(
  path.join(repositoryRoot, 'config/hosted-dr-capabilities.json'),
  'utf8',
));
const controlPlane = manifest?.controlPlane;
if (typeof manifest?.contractVersion !== 'string'
  || !controlPlane
  || typeof controlPlane.stableOrigin !== 'string'
  || typeof controlPlane.previewOrigin !== 'string'
  || typeof controlPlane.primaryOrigin !== 'string'
  || typeof controlPlane.drOrigin !== 'string'
  || !['not-provisioned', 'preview', 'production'].includes(controlPlane.provisioning)
  || !['deferred', 'verified'].includes(controlPlane.productionFallback?.artifactReadiness)
  || controlPlane.defaultMode !== 'client-preflight'
  || controlPlane.managedControlPlane !== 'optional-disabled'
  || !Number.isInteger(controlPlane.preflightTimeoutMs)
  || !Array.isArray(manifest.capabilities)) {
  throw new Error('Hosted DR manifest 缺少客户端 activation 投影字段');
}

const outputPath = path.join(
  repositoryRoot,
  'apps/web/config/hosted-dr-client.generated.ts',
);
await writeFile(outputPath, renderHostedDrClientConfig(manifest), 'utf8');
console.log('Hosted DR client-safe config generated.');
