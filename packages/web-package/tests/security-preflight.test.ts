import { describe, expect, it } from 'vitest';
import { createWebPackageInstance, digestWebPackageBytes, verifyWebPackage } from '../src';
import { canReuseWebPackageTrust, createWebPackageTrustGrant, scanWebPackageBase, scanWebPackageInstance } from '../src/security';

const encoder = new TextEncoder();
async function fixture(generated: string, baseCode = 'parent.document;') {
  const files = [{path:'index.html',mediaType:'text/html',text:baseCode},
    {path:'runtime.js',mediaType:'text/javascript',text:'window.runtime = true;'}];
  const descriptors = await Promise.all(files.map(async f => ({path:f.path,mediaType:f.mediaType,size:encoder.encode(f.text).length,digest:await digestWebPackageBytes(encoder.encode(f.text))})));
  const base = await verifyWebPackage({ format:'mahoshojo-web-package',formatVersion:1,id:'local.safety',version:'1.0',name:'本地预检',entry:'index.html',
    generation:{target:'index.html',mode:'replace',mediaType:'text/html'},files:descriptors },files.map(f=>({path:f.path,bytes:encoder.encode(f.text)})));
  const instance = await createWebPackageInstance(base,{packageRef:base.ref,targetPath:'index.html',targetMediaType:'text/html',generatedContent:generated,generatedDigest:await digestWebPackageBytes(encoder.encode(generated))});
  return {base,instance,profile:scanWebPackageInstance(instance)};
}

async function baseFixture(baseCode: string) {
  const files = [{path:'index.html',mediaType:'text/html',text:baseCode}];
  const descriptors = await Promise.all(files.map(async f => ({path:f.path,mediaType:f.mediaType,size:encoder.encode(f.text).length,digest:await digestWebPackageBytes(encoder.encode(f.text))})));
  return verifyWebPackage({ format:'mahoshojo-web-package',formatVersion:1,id:'local.markup',version:'1.0',name:'标记噪声',entry:'index.html',
    generation:{target:'index.html',mode:'replace',mediaType:'text/html'},files:descriptors },files.map(f=>({path:f.path,bytes:encoder.encode(f.text)})));
}

type ProbeFile = { path: string; mediaType: string; text: string };
async function probeFixture(files: ProbeFile[], generation: Record<string, unknown> = {}) {
  const entries = files.map(({ text, ...f }) => ({ ...f, bytes: encoder.encode(text) }));
  const descriptors = await Promise.all(entries.map(async f => ({ path: f.path, mediaType: f.mediaType, size: f.bytes.length, digest: await digestWebPackageBytes(f.bytes) })));
  return verifyWebPackage({
    format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.probe', version: '1.0', name: '探针',
    entry: 'index.html', generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html', ...generation },
    files: descriptors,
  }, entries);
}
const scanFiles = async (files: ProbeFile[], generation?: Record<string, unknown>) =>
  scanWebPackageBase(await probeFixture(files, generation));

describe('Web 包本地风险预检与独立同源授权', () => {
  it('scans base and effective overlay separately without retaining overwritten behavior', async () => {
    const {base,profile}=await fixture('<h1>纯展示</h1>');
    expect(scanWebPackageBase(base).categories).toContain('host-page-access');
    expect(profile.categories).not.toContain('host-page-access');
    expect(profile.categories).toContain('scripts');
    expect(profile.uncertainty.join(' ')).toContain('后续生成');
  });
  it('requires a generated target; one-shot does not cover a new result', async () => {
    const a=await fixture('<p>甲</p>'); const b=await fixture('<p>乙</p>');
    expect(()=>createWebPackageTrustGrant(scanWebPackageBase(a.base),'instance')).toThrow('生成目标');
    const grant=createWebPackageTrustGrant(a.profile,'instance');
    expect(canReuseWebPackageTrust(grant,a.profile)).toBe(true);
    expect(canReuseWebPackageTrust(grant,b.profile)).toBe(false);
  });
  it('reuses explicit revision trust but retriggers on new categories or destinations', async () => {
    const a=await fixture('<script>fetch("https://one.example/a")</script>');
    const b=await fixture('<script>fetch("https://one.example/b")</script>');
    const c=await fixture('<script>fetch("https://two.example/a")</script>');
    const d=await fixture('<script>parent.document;fetch("https://one.example/a")</script>');
    const grant=createWebPackageTrustGrant(a.profile,'revision');
    expect(canReuseWebPackageTrust(grant,b.profile)).toBe(true);
    expect(canReuseWebPackageTrust(grant,c.profile)).toBe(false);
    expect(canReuseWebPackageTrust(grant,d.profile)).toBe(false);
  });
  it('does not treat partial scans as persistent trust or a package rejection', async () => {
    const {profile}=await fixture('x'.repeat(600*1024));
    expect(profile.status).toBe('partial');
    expect(()=>createWebPackageTrustGrant(profile,'revision')).toThrow('不完整');
    expect(canReuseWebPackageTrust(createWebPackageTrustGrant(profile,'instance'),profile)).toBe(true);
  });
  it('fails closed for malformed, changed identity and obsolete policy grants', async () => {
    const {profile}=await fixture('<h1>结果</h1>'); const grant=createWebPackageTrustGrant(profile,'revision');
    for (const value of [null,{},'accepted',{...grant,policyVersion:0},{...grant,scannerVersion:0},{...grant,scope:['revision']},{...grant,profileStatus:['complete']},{...grant,categories:[{}]},{...grant,packageDigest:`sha256:${'0'.repeat(64)}`}]) {
      expect(canReuseWebPackageTrust(value,profile)).toBe(false);
    }
  });
  it('retains clear evidence and stable fingerprints without executing or normalizing source', async () => {
    const text='<script>localStorage.getItem("test");navigator.serviceWorker.register("sw.js")</script>';
    const {instance,profile}=await fixture(text);
    expect(profile.categories).toEqual(expect.arrayContaining(['site-storage','service-worker']));
    expect(scanWebPackageInstance(instance).fingerprint).toBe(profile.fingerprint);
    expect(instance.overlay.generatedContent).toBe(text);
    expect(profile.findings.some(f=>f.source==='overlay'&&f.path==='index.html')).toBe(true);
  });
  // `top` is a CSS property, a class name and an id in ordinary markup, and
  // `.parent`/`#parent`/`--parent` are selectors. Reporting those as host-page
  // access trains users to dismiss every real warning.
  it.each([
    '.bar i{position:absolute;left:0;top:0;height:8px}',
    '<div class="top"><span class="nm">标题</span></div>',
    '#toast{position:absolute;top:12%;color:red}',
    ':root{--top-gap:1rem} .x{margin-top:var(--top-gap)}',
    'el.scrollTop = 0; node.parentNode.remove(); box.offsetTop;',
    '<style>.wrap{background:url(logo.png)}</style><p>顶部 top bottom</p>',
  ])('does not report host-page access for ordinary markup: %s', async (code) => {
    expect(scanWebPackageBase(await baseFixture(code)).categories).not.toContain('host-page-access');
  });
  it.each([
    'parent.document.body.innerHTML = "x";',
    'window.top.location = "https://evil.example";',
    'window.parent.postMessage({}, "*");',
    'self.opener.location.reload();',
    'globalThis.frameElement.remove();',
  ])('still reports deliberate frame access: %s', async (code) => {
    expect(scanWebPackageBase(await baseFixture(code)).categories).toContain('host-page-access');
  });

  // 误报会消耗用户对全部警告的信任：下列信号在真实包里都不表示对应能力。
  it.each([
    ['<button onclick="go()">x</button>', 'scripts'],
    ['<div\nonmouseover="h()">x</div>', 'scripts'],
    ['<script src="x" data:text/javascript,alert(1)></script>', 'dynamic-execution'],
    ['<script src="blob:https://x/y"></script>', 'dynamic-execution'],
    ['document.cookie = "a=1"; caches.open("x");', 'site-storage'],
    ['new Worker("w.js"); navigator.serviceWorker.register("sw.js");', 'workers'],
    ['navigator.clipboard.writeText(t);', 'sensitive-api'],
    ['fetch("events.json");', 'network'],
  ])('still reports the real capability: %s', async (code, category) => {
    const profile = await scanFiles([{ path: 'index.html', mediaType: 'text/html', text: code }]);
    expect(profile.categories).toContain(category);
  });

  it.each([
    ['inline data image', '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="data:image/png;base64,iVBOR"/></svg>', 'image/svg+xml'],
    ['data attributes', '<div data-one="1" only-on="2" aria-online="false">x</div>', 'text/html'],
    ['identifiers in data', '{"oneTime": true, "onboarding": "enabled", "weight": 1}', 'application/json'],
    ['prose in markdown', '本包不依赖 localStorage/cookie，所有状态仅保存在内存中。', 'text/markdown'],
  ])('does not report %s as a capability', async (_label, text, mediaType) => {
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'asset', mediaType, text },
    ]);
    expect(profile.categories).toEqual([]);
  });

  it('excludes XML namespace identifiers from network destinations', async () => {
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'a.svg', mediaType: 'image/svg+xml', text: '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:serif="http://www.serif.com/"/>' },
    ]);
    expect(profile.externalOrigins).toEqual([]);
    expect(profile.categories).not.toContain('network');
  });

  it('keeps a genuine external origin', async () => {
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<script src="https://code.jquery.com/jquery.min.js"></script>' },
    ]);
    expect(profile.externalOrigins).toEqual(['https://code.jquery.com']);
  });

  it('does not scan prompt projection inputs as runtime content but discloses it', async () => {
    const instructions = '# 说明\n\n不要 fetch 后端，也不要使用 localStorage。示例：<script src="scripts/x.js"></script> 与 https://example.com\n';
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'ai/instructions.md', mediaType: 'text/markdown', text: instructions },
      { path: 'ai/assets.json', mediaType: 'application/json', text: instructions },
    ], { instructions: 'ai/instructions.md', assetCatalog: 'ai/assets.json' });
    expect(profile.findings.filter((finding) => finding.path !== 'index.html')).toEqual([]);
    expect(profile.uncertainty.join(' ')).toContain('提示词/说明文件未按运行时能力扫描');
  });
});
