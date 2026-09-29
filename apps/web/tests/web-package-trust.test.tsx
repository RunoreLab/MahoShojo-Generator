// @vitest-environment jsdom
import '@/tests/helpers/fake-indexeddb';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebPackageOverlay, digestWebPackageBytes, stageLocalWebPackage, verifyWebPackage, clearLocalWebPackageSessionStaging } from '@mahoshojo/web-package';
import { ArenaWebReport } from '@/components/arena/components/ArenaWebReport';
import { WebPackageFrame } from '@/components/arena/components/WebPackageFrame';
import { WEB_PACKAGE_TRUST_KEY_PREFIX } from '@/lib/web-package/trust';
import { downloadBlob } from '@/lib/client/blobUrl';

vi.mock('@/lib/client/blobUrl',()=>({downloadBlob:vi.fn()}));
let container:HTMLDivElement;
let root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear();container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{vi.useRealTimers();await act(async()=>root.unmount());container.remove();clearLocalWebPackageSessionStaging();vi.restoreAllMocks();vi.clearAllMocks();});
const button=(label:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)!;
const click=async(label:string)=>{expect(button(label),label).toBeTruthy();await act(async()=>button(label).click());};
async function waitReady() {
  for(let i=0;i<150;i++){
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    if(container.querySelector('iframe'))return;
  }
  throw new Error('Web 包 iframe 未出现：'+container.textContent);
}
async function fixture(content='<!doctype html><h1>本次结果</h1>',capabilities?:string[]) {
  const bytes=new TextEncoder().encode('<!doctype html><html><body>基础包</body></html>');
  const base=await verifyWebPackage({format:'mahoshojo-web-package',formatVersion:1,id:'local.trust-test',version:'1.0',name:'授权测试',entry:'index.html',...(capabilities?{capabilities}:{}),generation:{target:'index.html',mode:'replace',mediaType:'text/html'},files:[{path:'index.html',mediaType:'text/html',size:bytes.length,digest:await digestWebPackageBytes(bytes)}]},[{path:'index.html',bytes}]);
  stageLocalWebPackage(base);const {generatedContent,...artifact}=await createWebPackageOverlay(base.ref,content);
  return {base,artifact,content:generatedContent};
}
const viewer=(input:Awaited<ReturnType<typeof fixture>>)=> <ArenaWebReport roomId="trust-ui" ready content={input.content} webPackage={input.artifact}>
  {(web,actions)=><div>{web}{actions}</div>}
</ArenaWebReport>;
async function show(input:Awaited<ReturnType<typeof fixture>>) {
  localStorage.setItem('arena.web-report-consent.v1.room.trust-ui','accepted');
  await act(async()=>root.render(viewer(input)));await waitReady();
}
const startClock=()=>vi.useFakeTimers({toFake:['setInterval','clearInterval','performance']});
async function allow(remember=false) {
  startClock();await click('授权本站同源权限…');
  if(remember){const checkbox=document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!;await act(async()=>checkbox.click());}
  await act(async()=>{vi.advanceTimersByTime(3100);});
  await click(remember?'确认并保存此版本信任':'仅允许本次结果');vi.useRealTimers();
}

describe('Web 包可信同源授权 UI',()=>{
  it('keeps ordinary consent separate, enforces 3 seconds and recreates the frame on grant/revoke',async()=>{
    const input=await fixture();await show(input);const original=container.querySelector('iframe')!;
    expect(original.sandbox?.value??original.getAttribute('sandbox')).toBe('allow-scripts');
    startClock();await click('授权本站同源权限…');
    expect(document.body.textContent).toContain('这不是普通 Web 显示许可');
    expect(document.body.textContent).toContain('关闭网页不一定能撤回');
    const confirm=[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b=>b.textContent?.startsWith('请阅读风险说明'))!;
    expect(confirm.disabled).toBe(true);
    await act(async()=>{vi.advanceTimersByTime(2999);confirm.click();});
    expect(container.querySelector('iframe')).toBe(original);
    await act(async()=>{vi.advanceTimersByTime(101);});await click('仅允许本次结果');
    const trusted=container.querySelector('iframe')!;
    expect(trusted).not.toBe(original);expect(trusted.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(localStorage.getItem(WEB_PACKAGE_TRUST_KEY_PREFIX+input.base.ref.digest)).toBeNull();
    await click('撤销信任并回到受限模式');
    expect(container.querySelector('iframe')).not.toBe(trusted);expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });
  it('cancel retains the same restricted frame, all downloads and valid result',async()=>{
    const input=await fixture();await show(input);const original=container.querySelector('iframe');
    startClock();await click('授权本站同源权限…');await click('继续受限模式');
    expect(container.querySelector('iframe')).toBe(original);expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('⬇ 下载生成目标');expect(downloadBlob).toHaveBeenCalled();
    expect(button('⬇ 下载 Web 包 ZIP').disabled).toBe(false);expect(button('🌐 下载 HTML').disabled).toBe(false);
  });
  it('persistent exact revision trust is local, new behavior requires new approval, and cross-tab revoke is respected',async()=>{
    const initial=await fixture();const newRisk=await fixture('<!doctype html><script>fetch("https://new.example/report")</script>');
    await show(initial);await allow(true);
    const key=WEB_PACKAGE_TRUST_KEY_PREFIX+initial.base.ref.digest;
    expect(JSON.parse(localStorage.getItem(key)!).scope).toBe('revision');
    await act(async()=>root.render(viewer(newRisk)));await waitReady();
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
    expect(container.textContent).toContain('new.example');
    await act(async()=>root.render(viewer(initial)));await waitReady();
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toContain('allow-same-origin');
    await act(async()=>{localStorage.removeItem(key);window.dispatchEvent(new StorageEvent('storage',{key,newValue:null}));});
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });
  it('does not persist a partial scan, does not inherit old consent, and resets countdown on changed output',async()=>{
    const initial=await fixture();const partial=await fixture('<!doctype html><p>'+ 'a'.repeat(530*1024)+'</p>');
    await show(initial);startClock();await click('授权本站同源权限…');
    await act(async()=>{vi.advanceTimersByTime(2000);});vi.useRealTimers();
    await act(async()=>root.render(viewer(partial)));await waitReady();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    startClock();await click('授权本站同源权限…');
    const checkbox=document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!;
    expect(checkbox.disabled).toBe(true);expect(button('请阅读风险说明（3秒）').disabled).toBe(true);
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });
  it('does not count time spent in a background tab as reading the risk statement', async () => {
    const input = await fixture(); await show(input); startClock();
    await click('授权本站同源权限…');
    await act(async () => { vi.advanceTimersByTime(2000); });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(30000); });
    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(button('请阅读风险说明（1秒）').disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(button('仅允许本次结果').disabled).toBe(false);
  });

  it('allows only the current result when persistence fails and reports the failure honestly', async () => {
    const input = await fixture(); await show(input);
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await allow(true);
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(container.textContent).toContain('浏览器未能保存信任');
    expect(localStorage.getItem(WEB_PACKAGE_TRUST_KEY_PREFIX + input.base.ref.digest)).toBeNull();
    storage.mockRestore();
    await click('撤销信任并回到受限模式');
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('does not silently grant same-origin from malformed saved data',async()=>{
    const input=await fixture();localStorage.setItem(WEB_PACKAGE_TRUST_KEY_PREFIX+input.base.ref.digest,'accepted');
    await show(input);expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  // 两份完整清单并排会互相削弱：作者自述会被读成授权范围，预检警告退化成附注。
  // 风险声明只陈述两者不一致的事实，扫描结论始终独立完整呈现。
  it('shows only the disagreement between the author declaration and the scan',async()=>{
    const undeclared=await fixture('<!doctype html><script>localStorage.getItem("k")</script>',['scripts']);
    await show(undeclared);
    const text=container.querySelector('[data-testid="web-package-risk-summary"]')!.textContent!;
    expect(text).toContain('预检检测到：脚本执行、站点存储');
    expect(text).toContain('作者未声明，但预检检测到：站点存储');
    expect(text).not.toContain('作者声明：');
    const overdeclared=await fixture('<!doctype html><h1>无音频</h1>',['audio']);
    await act(async()=>root.render(viewer(overdeclared)));await waitReady();
    expect(container.querySelector('[data-testid="web-package-risk-summary"]')!.textContent!)
      .toContain('作者声明了，预检未检测到：音频');
  });
});

describe('Web 包运行页投递边界',()=>{
  it('accepts only the matching frame, origin and nonce, and sends content once',async()=>{
    const html='<script>packageOnly()</script>';
    await act(async()=>root.render(<WebPackageFrame html={html} trusted={false}/>));
    const frame=container.querySelector('iframe')!;const nonce=new URL(frame.src).searchParams.get('instance');
    const send=vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation(()=>undefined);
    const message=(source:Window|null,origin:string,n:string|null)=>new MessageEvent('message',{source,origin,data:{type:'maho-web-package:ready',nonce:n}});
    await act(async()=>{
      window.dispatchEvent(message(window,'null',nonce));
      window.dispatchEvent(message(frame.contentWindow,location.origin,nonce));
      window.dispatchEvent(message(frame.contentWindow,'null','wrong'));
    });
    expect(send).not.toHaveBeenCalled();expect(container.querySelector('script')).toBeNull();
    await act(async()=>window.dispatchEvent(message(frame.contentWindow,'null',nonce)));
    expect(send).toHaveBeenCalledExactlyOnceWith({type:'maho-web-package:mount',nonce,html},'*');
    await act(async()=>window.dispatchEvent(message(frame.contentWindow,'null',nonce)));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
