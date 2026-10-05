import { digestWebPackageBytes, stageLocalWebPackage, verifyWebPackage } from '../../src';

export const recordSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object', required: ['title', 'records'], additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1 },
    records: { type: 'array', minItems: 1, items: {
      type: 'object', required: ['value'], additionalProperties: false,
      properties: { value: { type: 'string' } },
    } },
  },
};

/** Local protocol fixture: no builtin registration or product runtime. */
export const createJsonPackage = async (version = '1.0.0', id = 'local.contract-fixture') => {
  const sources = [
    ['index.html', 'text/html', '<!doctype html><title>Protocol fixture</title>'],
    ['runtime/helper.js', 'text/javascript', 'globalThis.fixtureReady = true;'],
    ['styles/base.css', 'text/css', 'body { color: black; }'],
    ['assets/marker.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['data/record.json', 'application/json', JSON.stringify({ title: '初始记录', records: [{ value: '原始值' }] })],
    ['schemas/record.schema.json', 'application/json', JSON.stringify(recordSchema)],
    ['ai/instructions.md', 'text/markdown', 'Generate a record matching the schema.'],
    ['ai/assets.json', 'application/json', JSON.stringify({ resources: [{ path: 'assets/marker.svg', purpose: 'marker' }] })],
  ];
  const files = sources.map(([path, , content]) => ({ path, bytes: new TextEncoder().encode(content) }));
  const descriptors = await Promise.all(files.map(async (file, index) => ({
    path: file.path, mediaType: sources[index][1], size: file.bytes.length,
    digest: await digestWebPackageBytes(file.bytes),
  })));
  return verifyWebPackage({
    format: 'mahoshojo-web-package', formatVersion: 1, id, version, name: '本地协议测试包',
    entry: 'index.html', files: descriptors,
    generation: { target: 'data/record.json', mode: 'replace', mediaType: 'application/json',
      schema: 'schemas/record.schema.json', instructions: 'ai/instructions.md', assetCatalog: 'ai/assets.json' },
  }, files);
};

export const stageJsonPackage = async () => {
  const base = await createJsonPackage();
  stageLocalWebPackage(base);
  return base;
};
