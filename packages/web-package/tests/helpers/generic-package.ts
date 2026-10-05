import { createWebPackageInstance, digestWebPackageBytes, verifyWebPackage } from '../../src';

export async function createGenericTestPackage(options: {
  html?: string; generated?: string; target?: string;
  extra?: Record<string, { type: string; text: string; bytes?: Uint8Array }>;
} = {}) {
  const encoder = new TextEncoder();
  const target = options.target ?? 'data/report.json';
  const source: Record<string, { type: string; text: string; bytes?: Uint8Array }> = {
    'index.html': { type: 'text/html', text: options.html ?? '<!doctype html><html><head><title>本地包</title><link rel="stylesheet" href="styles/main.css"></head><body><h1 id="result">等待</h1><img id="image" src="assets/点.svg"><script src="runtime/classic.js" defer></script><script type="module" src="runtime/main.js"></script></body></html>' },
    'styles/main.css': { type: 'text/css', text: '@import "./nested/base.css"; #result{background-image:url("../assets/点.svg");}' },
    'styles/nested/base.css': { type: 'text/css', text: '#result { color: rgb(12,34,56); }' },
    'assets/点.svg': { type: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>' },
    'runtime/classic.js': { type: 'text/javascript', text: 'globalThis.classicReady = true; globalThis.rawString = "<img src=\\\"assets/点.svg\\\">";' },
    'runtime/main.js': { type: 'text/javascript', text: `import { value } from './nested/helper.js';
      const data = await fetch(new URL('../data/report.json', import.meta.url)).then(r => r.json());
      const dynamic = await import('./nested/dynamic.js');
      function Factory(){ this.wasNew = new.target === Factory; }
      document.querySelector('#result').textContent = data.title + ':' + value + ':' + dynamic.extra;
      globalThis.packageTest = { title: data.title, value, dynamic: dynamic.extra, wasNew: new Factory().wasNew, moduleURL: import.meta.url };
      try { globalThis.packageTest.parent = parent.document.title; } catch { globalThis.packageTest.parent = 'denied'; }
      try { globalThis.packageTest.storage = localStorage.getItem('maho-test-only'); } catch { globalThis.packageTest.storage = 'denied'; }` },
    'runtime/nested/helper.js': { type: 'text/javascript', text: 'export { value } from "./value.js";' },
    'runtime/nested/value.js': { type: 'text/javascript', text: 'export const value = 42;' },
    'runtime/nested/dynamic.js': { type: 'text/javascript', text: 'export const extra = "动态";' },
    'data/report.json': { type: 'application/json', text: '{"title":"基础内容"}' },
    ...options.extra,
  };
  const files = Object.entries(source).map(([path, file]) => ({ path, bytes: file.bytes ?? encoder.encode(file.text), type: file.type }));
  const manifest = { format:'mahoshojo-web-package',formatVersion:1,id:'local.generic-test',version:'1.0.0',name:'本地通用包',entry:'index.html',
    generation:{target,mediaType:target.endsWith('.json')?'application/json':'text/html',mode:'replace'},
    files: await Promise.all(files.map(async f=>({path:f.path,mediaType:f.type,size:f.bytes.length,digest:await digestWebPackageBytes(f.bytes)}))) };
  const base = await verifyWebPackage(manifest,files);
  const generatedContent = options.generated ?? '{"title":"覆盖内容"}';
  const instance = await createWebPackageInstance(base, { packageRef:base.ref,targetPath:target,targetMediaType:manifest.generation.mediaType as 'application/json'|'text/html',
    generatedContent, generatedDigest:await digestWebPackageBytes(encoder.encode(generatedContent)) });
  return { base,instance };
}
