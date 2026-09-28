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
    for (const value of [null,{},'accepted',{...grant,policyVersion:0},{...grant,categories:[{}]},{...grant,packageDigest:`sha256:${'0'.repeat(64)}`}]) {
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
});
