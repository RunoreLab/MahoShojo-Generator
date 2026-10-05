import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGenericTestPackage } from '@mahoshojo/web-package/testing/fixtures';
import { renderWebPackageInstance } from '@mahoshojo/web-package/browser';
import { createWebPackageInstance, packWebPackageZip, unpackWebPackageZip, BUILTIN_ARENA_NEWS_PACKAGE_REF, createWebPackageOverlay, resolveWebPackage } from '@mahoshojo/web-package';
import { WEB_PACKAGE_RUNNER_HEADERS, WEB_PACKAGE_RUNNER_HTML, WEB_PACKAGE_RUNNER_PATH } from '@/lib/web-package/runner';
import { buildContentSecurityPolicy } from '@/lib/security/browser-headers';

let browser: Browser;
let server: Server;
let origin: string;
let context: BrowserContext;
let page: Page;
let received: string[];
let requests: string[];

beforeAll(async () => {
  if (process.env.WEB_PACKAGE_NEXT_ORIGIN) {
    origin = process.env.WEB_PACKAGE_NEXT_ORIGIN.replace(/\/$/u, '');
    if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/u.test(origin)) throw new Error('只允许本机 Next 测试地址');
    const response = await fetch(origin + WEB_PACKAGE_RUNNER_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(WEB_PACKAGE_RUNNER_HEADERS.find(h => h.key === 'Content-Security-Policy')!.value);
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  } else {
  server = createServer((request,response) => {
    const path = request.url ?? '/';
    received.push(path);
    if (path.startsWith(WEB_PACKAGE_RUNNER_PATH + '?')) {
      response.writeHead(200,{...Object.fromEntries(WEB_PACKAGE_RUNNER_HEADERS.map(h=>[h.key,h.value])),'Content-Type':'text/html; charset=utf-8'});
      response.end(WEB_PACKAGE_RUNNER_HTML);
    } else if (path === '/') {
      response.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':buildContentSecurityPolicy({isProduction:false})});
      response.end('<!doctype html><title>Host</title><body>主站</body>');
    } else { response.writeHead(404); response.end('Not Found'); }
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const engine = process.env.WEB_PACKAGE_BROWSER ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error(`不支持的测试浏览器：${engine}`);
  browser = await ({ chromium, firefox, webkit }[engine as 'chromium' | 'firefox' | 'webkit']).launch({
    headless: true, ...(engine === 'chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] } : {}),
  });
});
afterAll(async()=>{await browser?.close();if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
beforeEach(async()=>{
  received=[];requests=[];context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(10_000);
  page.on('request',request=>requests.push(request.url()));
  if (process.env.WEB_PACKAGE_NEXT_ORIGIN) {
    // 只替换宿主测试页面，运行页使用真实 Next 路由和真实响应头；不触碰登录、Provider 或生产 API。
    await page.route(origin + '/', route => route.fulfill({ status: 200,
      headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': buildContentSecurityPolicy({ isProduction: true }) },
      body: '<!doctype html><title>Host</title><body>主站</body>' }));
  }
  await page.goto(origin);await page.evaluate(()=>localStorage.setItem('maho-test-only','fixture-only'));
});
afterEach(async()=>{await context?.close();});

async function mount(html:string,trusted=false) {
  await page.evaluate(({html,trusted,path})=>{
    document.querySelector('iframe')?.remove();
    const iframe=document.createElement('iframe');
    const nonce=crypto.randomUUID();
    iframe.sandbox.value=trusted?'allow-scripts allow-same-origin':'allow-scripts';
    iframe.setAttribute('referrerpolicy','no-referrer');
    iframe.src=path+'?instance='+nonce;
    const receive=(event:MessageEvent)=>{
      if(event.source!==iframe.contentWindow||event.data?.nonce!==nonce||event.data?.type!=='maho-web-package:ready')return;
      window.removeEventListener('message',receive);
      iframe.contentWindow!.postMessage({type:'maho-web-package:mount',nonce,html},trusted?location.origin:'*');
    };
    window.addEventListener('message',receive);
    document.body.append(iframe);
  },{html,trusted,path:WEB_PACKAGE_RUNNER_PATH});
  await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow!==null);
  const frame=page.frames().find(frame=>frame!==page.mainFrame());
  if(!frame)throw new Error('No package iframe');
  return frame;
}

describe('本地 Web 包真实浏览器资源空间',()=>{
  it('runs JSON overlay, nested ESM/CSS and images in an opaque frame without host access',async()=>{
    const {instance}=await createGenericTestPackage();
    const frame=await mount((await renderWebPackageInstance(instance)).html);
    await frame.waitForFunction(()=>Boolean((window as any).packageTest));
    expect(await frame.evaluate(()=>(window as any).packageTest)).toMatchObject({title:'覆盖内容',value:42,dynamic:'动态',wasNew:true,parent:'denied',storage:'denied'});
    expect(await frame.locator('#result').textContent()).toBe('覆盖内容:42:动态');
    await frame.waitForFunction(()=>(document.querySelector('#image') as HTMLImageElement).naturalWidth===4);
    expect(await frame.locator('#result').evaluate(node=>getComputedStyle(node).color)).toBe('rgb(12, 34, 56)');
    expect(await frame.evaluate(()=>(window as any).classicReady)).toBe(true);
    expect(await frame.evaluate(()=>(window as any).rawString)).toBe('<img src="assets/点.svg">');
    expect(requests.filter(url=>url.startsWith('https://web-package.invalid'))).toEqual([]);
    expect(received.filter(path=>path!=='/'&&!path.startsWith(WEB_PACKAGE_RUNNER_PATH+'?')&&path!=='/favicon.ico')).toEqual([]);
  });
  it('changes only the optional privilege level, keeping exact ZIP reimport behavior and a local 404',async()=>{
    const {base,instance}=await createGenericTestPackage();
    const imported=await unpackWebPackageZip(await packWebPackageZip(base));
    const html=(await renderWebPackageInstance(await createWebPackageInstance(imported,instance.overlay))).html;
    for(const trusted of [false,true,false]){
      const frame=await mount(html,trusted);await frame.waitForFunction(()=>Boolean((window as any).packageTest));
      expect(await frame.evaluate(()=>(window as any).packageTest.parent)).toBe(trusted?'Host':'denied');
      expect(await frame.evaluate(()=>(window as any).packageTest.storage)).toBe(trusted?'fixture-only':'denied');
      expect(await frame.evaluate(async()=>(await fetch('missing.json')).status)).toBe(404);
      expect(await frame.evaluate(async()=>(await fetch('data/report.json',{method:'POST'})).status)).toBe(405);
    }
    expect(requests.filter(url=>url.startsWith('https://web-package.invalid'))).toEqual([]);
  });
  it('supports cyclic imports, import-map aliases and computed dynamic imports without eval',async()=>{
    const {instance}=await createGenericTestPackage({html:'<script type="importmap">{"imports":{"alias":"./cycle-a.js"}}</script><script type="module">import {sum} from "alias"; const file="cycle-a"; const dynamic=await import("./"+file+".js"); globalThis.cycleTest=sum()+dynamic.sum();try{eval("1");globalThis.evalAllowed=true}catch{globalThis.evalAllowed=false}</script>',extra:{
      'cycle-a.js':{type:'text/javascript',text:'import {readB} from "./cycle-b.js";export function readA(){return 1};export const sum=()=>readA()+readB();'},
      'cycle-b.js':{type:'text/javascript',text:'import {readA} from "./cycle-a.js";export const readB=()=>readA()+1;'},
    }});
    const frame=await mount((await renderWebPackageInstance(instance)).html);await frame.waitForFunction(()=>(window as any).cycleTest===6);
    // CDP 的 frame.evaluate 本身可绕过 CSP；必须检查真正包脚本中的 eval 结果。
    expect(await frame.evaluate(()=>(window as any).evalAllowed)).toBe(false);
  });
  it('maps runtime media URLs and fetch(new URL(..., import.meta.url)) without uploading the package',async()=>{
    const {instance}=await createGenericTestPackage();const frame=await mount((await renderWebPackageInstance(instance)).html);
    await frame.waitForFunction(()=>Boolean((window as any).packageTest));
    await frame.evaluate(()=>{
      const image=new Image();image.id='dynamic-image';image.src=new URL('assets/点.svg',document.baseURI).href;document.body.append(image);
      const link=document.createElement('link');link.rel='stylesheet';link.href='./styles/main.css';document.head.append(link);
    });
    await frame.waitForFunction(()=>(document.querySelector('#dynamic-image') as HTMLImageElement).naturalWidth===4);
    const response=await frame.evaluate(async()=>{const r=await fetch('data/report.json?version=1#part');return {status:r.status,type:r.headers.get('content-type'),data:await r.json()};});
    expect(response).toEqual({status:200,type:'application/json',data:{title:'覆盖内容'}});
    expect(requests.filter(url=>url.startsWith('https://web-package.invalid'))).toEqual([]);
  });
  it('resolves dynamic imports in classic callbacks and late-created scripts', async () => {
    const { instance } = await createGenericTestPackage({
      html: '<script src="load.js"></script>',
      extra: {
        'load.js': { type: 'text/javascript', text: `setTimeout(async () => {
          const loaded = await import /* 注释也必须被解析 */ ('./runtime/nested/value.js');
          globalThis.callbackValue = loaded.value;
          const script = document.createElement('script');
          script.src = './late.js'; document.head.append(script);
        }, 0);` },
        'late.js': { type: 'text/javascript', text: `import /* 动态加载脚本 */ ('./runtime/nested/value.js').then(m => globalThis.lateValue = m.value);` },
      },
    });
    const frame = await mount((await renderWebPackageInstance(instance)).html);
    await frame.waitForFunction(() => (window as any).lateValue === 42);
    expect(await frame.evaluate(() => (window as any).callbackValue)).toBe(42);
    expect(requests.filter(url => url.startsWith('https://web-package.invalid'))).toEqual([]);
  });

  it('renders the builtin and its local ZIP through the same generic path, including generated HTML', async () => {
    const ref = BUILTIN_ARENA_NEWS_PACKAGE_REF;
    const base = await resolveWebPackage(ref);
    const output = '<!doctype html><title>通用新闻</title><link rel="stylesheet" href="styles/news.css"><h1>通用新闻</h1><img id="brand" src="assets/brand/arena.svg"><script src="scripts/news.js" defer></script><script>globalThis.htmlTargetReady=true</script>';
    const overlay = await createWebPackageOverlay(ref, output);
    const imported = await unpackWebPackageZip(await packWebPackageZip(base));
    const first = await renderWebPackageInstance(await createWebPackageInstance(base, overlay));
    const second = await renderWebPackageInstance(await createWebPackageInstance(imported, overlay));
    expect(first).toEqual(second);
    for (const html of [first.html, second.html]) {
      const frame = await mount(html);
      await frame.waitForFunction(() => (window as any).htmlTargetReady === true);
      await frame.waitForFunction(() => (document.querySelector('#brand') as HTMLImageElement).naturalWidth > 0);
      expect(await frame.title()).toBe('通用新闻');
      expect(await frame.locator('h1').textContent()).toBe('通用新闻');
    }
  });

  it('serves local media, preserves srcset data commas and applies rewritten CSS despite original SRI', async () => {
    // 合法 PCM WAV：8000 Hz、16 bit、单声道、0.1 秒静音，不依赖外部素材或声音设备。
    const wav = new Uint8Array(1644); const view = new DataView(wav.buffer);
    for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) wav.set(new TextEncoder().encode(value), offset);
    for (const [offset, value] of [[4, 1636], [16, 16], [24, 8000], [28, 16000], [40, 1600]]) view.setUint32(offset, value, true);
    for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
    const { instance } = await createGenericTestPackage({ html: `<link rel="stylesheet" href="styles/main.css" integrity="sha256-invalid"><h1 id="result">媒体</h1><audio id="audio" src="tone.wav" preload="metadata"></audio><img id="set" srcset="data:image/svg+xml;base64,PHN2Zy8+ 1x, assets/点.svg 2x">`, extra: {
      'tone.wav': { type: 'audio/wav', text: '', bytes: wav },
    } });
    const frame = await mount((await renderWebPackageInstance(instance)).html);
    await frame.waitForSelector('#audio', { state: 'attached' });
    expect(await frame.locator('#audio').getAttribute('src')).toMatch(/^data:audio\/wav;base64,/u);
    expect(await frame.locator('#set').getAttribute('srcset')).toContain('data:image/svg+xml;base64,PHN2Zy8+ 1x, data:image/svg+xml;base64,');
    await frame.waitForFunction(() => getComputedStyle(document.querySelector('#result')!).color === 'rgb(12, 34, 56)');
    await frame.waitForFunction(() => (document.querySelector('#audio') as HTMLAudioElement).readyState >= 1);
    expect(await frame.locator('#audio').evaluate(element => (element as HTMLAudioElement).duration)).toBeCloseTo(0.1);
    expect(await frame.evaluate(async () => { const r = await fetch('tone.wav'); return [r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; })).toEqual(['audio/wav', 1644]);
  });

  it('does not execute a wrong nonce or a message from a sibling frame',async()=>{
    await page.evaluate(path=>{
      const iframe=document.createElement('iframe');iframe.id='target';iframe.sandbox.value='allow-scripts';iframe.src=path+'?instance=0123456789abcdef';document.body.append(iframe);
    },WEB_PACKAGE_RUNNER_PATH);
    const frame=page.frames().find(f=>f!==page.mainFrame())!;
    await frame.waitForSelector('p');
    await page.evaluate(()=>document.querySelector<HTMLIFrameElement>('#target')!.contentWindow!.postMessage({type:'maho-web-package:mount',nonce:'wrong',html:'<script>globalThis.unexpected=true</script>'},'*'));
    expect(await frame.evaluate(()=>(window as any).unexpected)).toBeUndefined();
    expect(await frame.locator('p').textContent()).toBe('等待本地 Web 包…');
    await page.evaluate(() => {
      const sibling=document.createElement('iframe');
      sibling.srcdoc='<script>parent.frames[0].postMessage({type:"maho-web-package:mount",nonce:"0123456789abcdef",html:"<p>错误来源</p>"},"*")</script>';
      document.body.append(sibling);
    });
    await page.waitForFunction(()=>document.querySelectorAll('iframe').length===2);
    expect(await frame.locator('p').textContent()).toBe('等待本地 Web 包…');
  });
});
