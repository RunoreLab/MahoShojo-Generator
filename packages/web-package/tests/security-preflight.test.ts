import { describe, expect, it } from 'vitest';
import { createWebPackageInstance, digestWebPackageBytes, verifyWebPackage } from '../src';
import {
  canReuseWebPackageTrust, createWebPackageTrustGrant, diffWebPackageDeclaration,
  scanWebPackageBase, scanWebPackageInstance, webPackageRiskLabel,
} from '../src/security';

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

type ProbeFile = { path: string; mediaType: string; text: string | Uint8Array };
const bytesOf = (value: string | Uint8Array): Uint8Array => (typeof value === 'string' ? encoder.encode(value) : value);
async function probeFixture(files: ProbeFile[], generation: Record<string, unknown> = {}) {
  const entries = files.map(({ text, ...f }) => ({ ...f, bytes: bytesOf(text) }));
  const descriptors = await Promise.all(entries.map(async f => ({ path: f.path, mediaType: f.mediaType, size: f.bytes.length, digest: await digestWebPackageBytes(f.bytes) })));
  return verifyWebPackage({
    format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.probe', version: '1.0', name: '探针',
    entry: 'index.html', generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html', ...generation },
    files: descriptors,
  }, entries);
}
const scanFiles = async (files: ProbeFile[], generation?: Record<string, unknown>) =>
  scanWebPackageBase(await probeFixture(files, generation));
const instanceFiles = async (files: ProbeFile[], target: string, generated: string) => {
  const base = await probeFixture(files, { target });
  const instance = await createWebPackageInstance(base, { packageRef: base.ref, targetPath: target,
    targetMediaType: 'text/html', generatedContent: generated, generatedDigest: await digestWebPackageBytes(encoder.encode(generated)) });
  return scanWebPackageInstance(instance);
};

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

  it('does not report a scan gap for oversized known binaries', async () => {
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'assets/movie.mp4', mediaType: 'video/mp4', text: '\u0000\u0001'.repeat(400 * 1024) },
    ]);
    expect(profile.status).toBe('complete');
    expect(profile.categories).toEqual(['video']);
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

  it('does not scan prompt projection inputs as runtime content but discloses it', async () => {    const instructions = '# 说明\n\n不要 fetch 后端，也不要使用 localStorage。示例：<script src="scripts/x.js"></script> 与 https://example.com\n';
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'ai/instructions.md', mediaType: 'text/markdown', text: instructions },
      { path: 'ai/assets.json', mediaType: 'application/json', text: instructions },
    ], { instructions: 'ai/instructions.md', assetCatalog: 'ai/assets.json' });
    expect(profile.findings.filter((finding) => finding.path !== 'index.html')).toEqual([]);
    expect(profile.uncertainty.join(' ')).toContain('提示词/说明文件未按运行时能力扫描');
  });

  // 声明的 mediaType 由作者给出。把脚本声明成 image/png 曾让整段文本扫描
  // 被跳过，扫描器因此报告"零能力"——严格性放错了层，却挡住了正常导入。
  it('still scans a text file mislabelled as a binary media type', async () => {
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      {
        path: 'assets/payload.png',
        mediaType: 'image/png',
        text: '<script>fetch("https://evil.example/x");eval(1)</script>',
      },
    ]);
    expect(profile.categories).toEqual(expect.arrayContaining(['network', 'dynamic-execution', 'scripts']));
    expect(profile.externalOrigins).toEqual(['https://evil.example']);
  });

  it('still skips genuine known binaries', async () => {
    const profile = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'assets/photo.png', mediaType: 'image/png', text: ' binary-ish' },
    ]);
    expect(profile.categories).toEqual([]);
  });

  // 授权判断依赖生成目标的扫描结论。让基础包按路径序抢走预算，会把最该被扫描的
  // 文件挤掉——这个方向性错误即使 fail-closed 也救不回来。
  it('gives the generated target the scan budget before any base file', async () => {
    // 填充文件按路径序全部排在生成目标之前，总量超过 4 MiB 预算；目标本身足够大，
    // 旧顺序下剩余预算装不下它，因此"是否扫到目标"完全取决于扫描次序。
    const pads = Array.from({ length: 10 }, (_, index) => ({
      path: `a-pad-${index}.js`, mediaType: 'text/javascript', text: `/*${'x'.repeat(500 * 1024)}*/`,
    }));
    const generated = `document.cookie = "a=1";${'x'.repeat(200 * 1024)}`;
    const profile = await instanceFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      ...pads,
      { path: 'zz-target.html', mediaType: 'text/html', text: '<p>占位</p>' },
    ], 'zz-target.html', generated);
    expect(profile.findings.some((finding) => finding.source === 'overlay' && finding.category === 'site-storage')).toBe(true);
    expect(profile.status).toBe('partial');
    expect(profile.uncertainty.join(' ')).toContain('a-pad-');
  });

  it('names the unscanned files so the consent dialog stays actionable', async () => {
    const oversized = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'a-oversized.html', mediaType: 'text/html', text: 'x'.repeat(600 * 1024) },
    ]);
    expect(oversized.status).toBe('partial');
    expect(oversized.uncertainty.join(' ')).toContain('a-oversized.html');
    const undecodable = await scanFiles([
      { path: 'index.html', mediaType: 'text/html', text: '<p>纯展示</p>' },
      { path: 'broken.json', mediaType: 'application/json', text: new Uint8Array([0xff, 0xfe, 0x00, 0x01]) },
    ]);
    expect(undecodable.status).toBe('partial');
    expect(undecodable.uncertainty.join(' ')).toContain('broken.json');
  });
});

// 完整的两份能力清单并排陈列会互相削弱：读者会把作者自述当成授权范围，预检警告
// 退化成附注。差异是「作者声明」唯一值得展示的内容。
describe('作者声明与预检结论的差异', () => {
  const declared = async (capabilities: string[], detected: string) => {
    const text = detected;
    const base = await verifyWebPackage({ format: 'mahoshojo-web-package', formatVersion: 1, id: 'local.decl',
      version: '1.0', name: '声明对照', entry: 'index.html', capabilities,
      generation: { target: 'index.html', mode: 'replace', mediaType: 'text/html' },
      files: [{ path: 'index.html', mediaType: 'text/html', size: encoder.encode(text).length, digest: await digestWebPackageBytes(encoder.encode(text)) }] },
    [{ path: 'index.html', bytes: encoder.encode(text) }]);
    return scanWebPackageBase(base);
  };

  it('reports capabilities detected without a declaration', async () => {
    const profile = await declared([], 'localStorage.getItem("k");');
    expect(profile.categories).toContain('site-storage');
    expect(diffWebPackageDeclaration(profile).undeclaredDetected).toContain('site-storage');
  });

  it('produces no diff when the declaration matches the scan', async () => {
    const profile = await declared(['scripts'], '<script>x()</script>');
    expect(profile.declared).toEqual(['scripts']);
    expect(diffWebPackageDeclaration(profile)).toEqual({ undeclaredDetected: [], declaredNotDetected: [] });
  });

  it('keeps a declared-but-undetected capability out of the detected list', async () => {
    const profile = await declared(['audio'], '<p>纯展示</p>');
    expect(profile.categories).toEqual([]);
    expect(diffWebPackageDeclaration(profile)).toEqual({ undeclaredDetected: [], declaredNotDetected: ['audio'] });
  });

  it('labels categories and passes unregistered declaration values through', () => {
    expect(webPackageRiskLabel('site-storage')).toBe('站点存储');
    expect(webPackageRiskLabel('__proto__')).toBe('__proto__');
    expect(webPackageRiskLabel('toString')).toBe('toString');
  });
});
