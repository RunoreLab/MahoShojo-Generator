import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { renderWebPackageInstance } from '../src/render';
import { buildWebPackagePromptProjection, createWebPackageInstance, createWebPackageOverlayFromProjection, packWebPackageZip, unpackWebPackageZip } from '../src';
import { importWebPackageArchive } from '../src/import';
import { createGenericTestPackage } from './helpers/generic-package';

type Plan = { entry:string;root:string;files:Record<string,{mediaType:string;base64:string}>;modules:Record<string,{code:string}> };
function readPlan(html:string): Plan {
  const doc=parse(html); let text='';
  const visit=(n:DefaultTreeAdapterMap['node'])=>{if('tagName'in n&&n.tagName==='script')for(const c of n.childNodes)if(c.nodeName==='#text'&&(c as DefaultTreeAdapterMap['textNode']).value.startsWith('(function (plan)'))text=(c as DefaultTreeAdapterMap['textNode']).value;
    if('childNodes'in n)n.childNodes.forEach(visit);};
  visit(doc);return JSON.parse(text.slice(text.lastIndexOf('})(')+3,-2));
}
describe('通用 Web 包物化',()=>{
  it('reads the entry and overlays JSON without altering immutable bytes',async()=>{
    const {base,instance}=await createGenericTestPackage();const html=await renderWebPackageInstance(instance);const plan=readPlan(html.html);
    expect(html.html).toContain('<h1 id="result">等待</h1>');
    expect(atob(plan.files['data/report.json'].base64)).toContain('覆盖内容'.split('').map(c=>String.fromCharCode(...new TextEncoder().encode(c))).join(''));
    expect(new TextDecoder().decode(base.readFile('data/report.json'))).toContain('基础内容');
    expect(Object.values(plan.modules).map(m=>m.code).join('\n')).toContain('new.target');
    expect(Object.values(plan.modules).map(m=>m.code).join('\n')).toContain('__MAHO_WEB_PACKAGE__.meta');
    expect(html.html).toContain('data:text/css;base64,');
  });
  it('uses identical presentation bytes after ZIP export and import',async()=>{
    const {base,instance}=await createGenericTestPackage();const reimport=await unpackWebPackageZip(await packWebPackageZip(base));
    expect(reimport.ref).toEqual(base.ref);
    expect(await renderWebPackageInstance(await createWebPackageInstance(reimport,instance.overlay))).toEqual(await renderWebPackageInstance(instance));
  });
  it('uses generated HTML as entry and preserves embedded closing-tag strings in source',async()=>{
    const generated='<!doctype html><html><head><title>新网页</title></head><body><script type="module">const text="<tag>";globalThis.mark=text;</script><h1>生成入口</h1></body></html>';
    const {instance}=await createGenericTestPackage({target:'index.html',generated});const result=await renderWebPackageInstance(instance);
    expect(result.html).toContain('生成入口');expect(Object.values(readPlan(result.html).modules).map(m=>m.code).join('\n')).toContain('const text="<tag>"');
  });
  it('rejects missing local files and escape paths rather than fetching host content',async()=>{
    for(const src of ['missing.js','../../api/private.js']){
      const {instance}=await createGenericTestPackage({html:`<script src="${src}"></script>`});
      await expect(renderWebPackageInstance(instance)).rejects.toThrow(/资源不存在|超出/u);
    }
  });
  it('resolves cyclic modules, query identities, import maps and dynamic literals',async()=>{
    const {instance}=await createGenericTestPackage({html:'<script type="importmap">{"imports":{"alias":"./cycle-a.js"}}</script><script type="module">import "alias";await import("alias");await import("./cycle-a.js?v=1");</script>',extra:{
      'cycle-a.js':{type:'text/javascript',text:'import {readB} from "./cycle-b.js";export function readA(){return 1};export const sum=()=>readA()+readB();'},
      'cycle-b.js':{type:'text/javascript',text:'import {readA} from "./cycle-a.js";export const readB=()=>readA()+1;'},
    }});
    const plan=readPlan((await renderWebPackageInstance(instance)).html);
    expect(Object.keys(plan.modules).some(k=>k.endsWith('cycle-a.js?v=1'))).toBe(true);
    expect(Object.values(plan.modules).some(m=>m.code.includes('importFrom.bind'))).toBe(true);
  });
  it('reports unsupported document navigation without granting permissions',async()=>{
    const {instance}=await createGenericTestPackage({html:'<a href="page.html">跳转</a>',extra:{'page.html':{type:'text/html',text:'<p>第二页</p>'}}});
    expect((await renderWebPackageInstance(instance)).diagnostics.join(' ')).toContain('多文档');
  });
  // 真实第三方包（quequan-game）就是这个形态：files 未声明、带 favicon.ico、
  // 生成目标是页面 fetch 的一份 JSON。以前一个 .ico 就让整个包无法导入。
  it('imports a derived file table with a favicon and an AI-generated JSON target',async()=>{
    const encoder=new TextEncoder();
    const {zipSync}=await import('fflate');
    const archive=zipSync({
      'index.html':encoder.encode('<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="icon" href="static/favicon.ico"><title>事件引擎</title></head><body><script>fetch("static/events.json").then(r=>r.json()).then(e=>globalThis.events=e);</script></body></html>'),
      'static/favicon.ico':encoder.encode('icon-bytes'),
      'static/events.json':encoder.encode('[{"id":"e001","text":"示例事件"}]'),
      'web-package.json':encoder.encode(JSON.stringify({
        format:'mahoshojo-web-package',formatVersion:1,id:'local.derived',version:'1.0.0',name:'派生包',
        entry:'index.html',generation:{target:'static/events.json',mode:'replace',mediaType:'application/json'},
      })),
    });
    const {pkg,diagnostics}=await importWebPackageArchive(archive);
    expect(diagnostics.join('\n')).not.toContain('不透明二进制');
    expect(pkg.manifest.files.find(f=>f.path==='static/favicon.ico')?.mediaType).toBe('image/vnd.microsoft.icon');
    const projection=buildWebPackagePromptProjection(pkg);
    const generated='[{"id":"e001","text":"AI 重写的事件"}]';
    const instance=await createWebPackageInstance(pkg,await createWebPackageOverlayFromProjection(projection,generated));
    const html=(await renderWebPackageInstance(instance)).html;
    expect(html).toContain('data:image/vnd.microsoft.icon;base64,');
    const plan=readPlan(html);
    expect(new TextDecoder().decode(Uint8Array.from(atob(plan.files['static/events.json'].base64),(c)=>c.charCodeAt(0))))
      .toBe(generated);
    expect(new TextDecoder().decode(pkg.readFile('static/events.json')!)).not.toContain('AI 重写');
  });
});
