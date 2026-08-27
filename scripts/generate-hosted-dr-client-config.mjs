import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderHostedDrClientConfig } from './hosted-dr-client-config.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(
  path.join(repositoryRoot, 'config/hosted-dr-capabilities.json'),
  'utf8',
));
const stableOrigin = manifest?.controlPlane?.stableOrigin;
const previewOrigin = manifest?.controlPlane?.previewOrigin;
const controlPlaneProvisioning = manifest?.controlPlane?.provisioning;
const productionFallbackReadiness = manifest?.controlPlane
  ?.productionFallback?.artifactReadiness;
if (typeof stableOrigin !== 'string' || !stableOrigin
  || typeof previewOrigin !== 'string' || !previewOrigin
  || !['not-provisioned', 'preview', 'production'].includes(controlPlaneProvisioning)
  || !['deferred', 'verified'].includes(productionFallbackReadiness)) {
  throw new Error('Hosted DR manifest 缺少客户端 activation 投影字段');
}

const outputPath = path.join(
  repositoryRoot,
  'apps/web/config/hosted-dr-client.generated.ts',
);
await writeFile(outputPath, renderHostedDrClientConfig(
  stableOrigin,
  previewOrigin,
  controlPlaneProvisioning,
  productionFallbackReadiness,
), 'utf8');
console.log('Hosted DR client-safe config generated.');
