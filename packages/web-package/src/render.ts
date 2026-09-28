import { parse as parseHtml, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { parse as parseJavaScript } from 'acorn';
import { parse as parseCss, walk as walkCss, generate as generateCss } from 'css-tree';
import type { WebPackageInstance } from './index';
import { WebPackagePathSchema } from '@mahoshojo/contracts/web-package';
import { WEB_PACKAGE_BOOTSTRAP } from './materialization/bootstrap';

type HtmlNode = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type SyntaxNode = { type: string; start: number; end: number; [key: string]: unknown };
type LocalFile = { mediaType: string; base64: string };
type ModuleFile = { mediaType: string; code: string };
type Resource = { url: string; external: true } | { url: string; path: string; hash: string; external: false };
export type WebPackagePresentation = Readonly<{ kind: 'srcdoc'; html: string; diagnostics: readonly string[] }>;
export class WebPackageRenderError extends Error {
  constructor(message: string) { super(message); this.name = 'WebPackageRenderError'; }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const jsType = (type: string) => type === 'text/javascript' || type === 'application/javascript';
const b64 = (bytes: Uint8Array): string => {
  let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
};
const dataUrl = (bytes: Uint8Array, type: string) => `data:${type};base64,${b64(bytes)}`;
const isElement = (node: HtmlNode): node is Element => 'tagName' in node;
const attr = (node: Element, name: string): string | undefined => node.attrs.find(a => a.name === name)?.value;
const setAttr = (node: Element, name: string, value: string) => {
  const existing = node.attrs.find(a => a.name === name); if (existing) existing.value = value; else node.attrs.push({ name, value });
};
const dropAttr = (node: Element, name: string) => { node.attrs = node.attrs.filter(a => a.name !== name); };
const textContent = (node: Element) => node.childNodes.map(n => n.nodeName === '#text' ? (n as DefaultTreeAdapterMap['textNode']).value : '').join('');
const setText = (node: Element, text: string) => { node.childNodes = [{ nodeName: '#text', value: text, parentNode: node }]; };
const element = (tag: string): Element => ({ nodeName: tag, tagName: tag, attrs: [], namespaceURI: 'http://www.w3.org/1999/xhtml' as Element['namespaceURI'], childNodes: [], parentNode: null });
function walkHtml(node: HtmlNode, visit: (_node: Element) => void): void {
  if (isElement(node)) visit(node);
  if ('childNodes' in node) for (const child of [...node.childNodes]) walkHtml(child, visit);
  if (isElement(node) && node.tagName === 'template' && 'content' in node) walkHtml(node.content as HtmlNode, visit);
}
function remove(node: Element): void {
  if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter(n => n !== node);
}

/**
 * 通用浏览器文件物化：只读取已经验证的实例，不按预设 ID 特判，不在宿主执行代码或联网。
 * Blob 模块由 iframe 内 bootstrap 创建，因此 Restricted Mode 也不依赖 same-origin/SW。
 */
export async function renderWebPackageInstance(instance: WebPackageInstance): Promise<WebPackagePresentation> {
  const root = `https://web-package.invalid/${instance.base.ref.digest.slice(7)}/`;
  const fileUrl = (path: string) => root + path.split('/').map(encodeURIComponent).join('/');
  const entry = fileUrl(instance.base.manifest.entry);
  const descriptors = new Map(instance.base.manifest.files.map(file => [file.path, file.mediaType]));
  descriptors.set(instance.overlay.targetPath, instance.overlay.targetMediaType);
  const files: Record<string, LocalFile> = Object.create(null);
  for (const [path, mediaType] of descriptors) {
    const bytes = instance.readFile(path); if (!bytes) throw new WebPackageRenderError(`Web 包资源不存在：${path}`);
    files[path] = { mediaType, base64: b64(bytes) };
  }
  const readText = (path: string) => {
    const bytes = instance.readFile(path); if (!bytes) throw new WebPackageRenderError(`Web 包资源不存在：${path}`);
    try { return decoder.decode(bytes); } catch { throw new WebPackageRenderError(`Web 包文本不是 UTF-8：${path}`); }
  };
  const resolve = (reference: string, base: string): Resource => {
    let url: URL;
    try { url = new URL(reference, base); } catch { throw new WebPackageRenderError(`资源 URL 无法解析：${reference}`); }
    if (url.origin !== new URL(root).origin) {
      if (!['https:', 'http:', 'data:', 'blob:'].includes(url.protocol)) throw new WebPackageRenderError(`不支持的资源协议：${url.protocol}`);
      return { external: true, url: url.href };
    }
    if (!url.href.startsWith(root)) throw new WebPackageRenderError(`资源路径超出 Web 包：${reference}`);
    let path: string;
    try { path = decodeURIComponent(url.pathname.slice(new URL(root).pathname.length)); WebPackagePathSchema.parse(path); }
    catch { throw new WebPackageRenderError(`Web 包资源路径非法：${reference}`); }
    if (!Object.prototype.hasOwnProperty.call(files, path)) throw new WebPackageRenderError(`Web 包资源不存在：${path}`);
    return { external: false, path, url: url.href, hash: url.hash };
  };
  const diagnostics = new Set<string>();
  const cssCache = new Map<string, string>();
  const cssStack = new Set<string>();
  const cssFile = (path: string): string => {
    const cached = cssCache.get(path); if (cached) return cached;
    if (cssStack.has(path)) throw new WebPackageRenderError(`CSS 循环导入：${path}`);
    cssStack.add(path);
    try {
      const result = dataUrl(encoder.encode(rewriteCss(readText(path), fileUrl(path))), 'text/css');
      cssCache.set(path, result); return result;
    } finally { cssStack.delete(path); }
  };
  const asset = (reference: string, base: string): string => {
    if (!reference || reference.startsWith('#')) return reference;
    const found = resolve(reference, base); if (found.external) return found.url;
    return (files[found.path].mediaType === 'text/css' ? cssFile(found.path)
      : `data:${files[found.path].mediaType};base64,${files[found.path].base64}`) + found.hash;
  };
  function rewriteCss(css: string, base: string, inline = false): string {
    try {
      const ast = parseCss(css, { context: inline ? 'declarationList' : 'stylesheet', parseCustomProperty: true });
      walkCss(ast, node => {
        if (node.type === 'Url') node.value = asset(node.value, base);
        if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude?.type === 'AtrulePrelude') {
          const first = node.prelude.children.first;
          if (first?.type === 'String') first.value = asset(first.value, base);
        }
        if (node.type === 'Raw' && /(?:url\s*\(|@import)/iu.test(node.value)) throw new WebPackageRenderError('CSS 资源引用无法可靠解析');
      });
      return generateCss(ast);
    } catch (error) {
      if (error instanceof WebPackageRenderError) throw error;
      throw new WebPackageRenderError(`CSS 解析失败：${base}`);
    }
  }
  const document = parseHtml(readText(instance.base.manifest.entry));
  const importAliases: Record<string, string> = Object.create(null);
  walkHtml(document, node => {
    if (node.tagName !== 'script' || attr(node, 'type')?.toLowerCase() !== 'importmap') return;
    try {
      const map = JSON.parse(textContent(node)) as { imports?: Record<string, unknown>; scopes?: unknown };
      if (map.scopes) throw new Error('scopes');
      for (const [name, value] of Object.entries(map.imports ?? {})) {
        if (typeof value !== 'string') throw new Error('mapping');
        importAliases[name] = new URL(value, entry).href;
      }
    } catch { throw new WebPackageRenderError('V1 支持 import map imports；scopes、null 映射或无效 JSON 请先在创作时展开'); }
    remove(node);
  });
  const resolveModule = (value: string, base: string): Resource => {
    let mapped = value;
    const alias = Object.keys(importAliases).sort((a, b) => b.length - a.length).find(key => key === value || key.endsWith('/') && value.startsWith(key));
    if (alias) mapped = importAliases[alias] + (alias.endsWith('/') ? value.slice(alias.length) : '');
    else if (!value.startsWith('.') && !value.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
      throw new WebPackageRenderError(`缺少模块映射：${value}`);
    }
    return resolve(mapped, base);
  };
  const modules: Record<string, ModuleFile> = Object.create(null);
  const moduleFailures = new Map<string, Error>();
  function ensureModule(found: Resource): void {
    if (found.external || modules[found.url]) return;
    if (moduleFailures.has(found.url)) throw moduleFailures.get(found.url)!;
    const mediaType = files[found.path].mediaType;
    if (mediaType !== 'application/json' && !jsType(mediaType)) throw new WebPackageRenderError(`模块类型不受支持：${found.path}`);
    modules[found.url] = { code: '', mediaType };
    try {
      const source = readText(found.path);
      modules[found.url].code = mediaType === 'application/json' ? source : rewriteJavaScript(source, found.url, 'module');
    } catch (error) {
      delete modules[found.url]; moduleFailures.set(found.url, error as Error); throw error;
    }
  }
  function rewriteJavaScript(source: string, base: string, mode: 'script' | 'module'): string {
    // 注释可出现在 import 与括号之间，不能用紧邻字符判断漏掉合法动态导入。
    if (mode === 'script' && !/\bimport\b/u.test(source)) return source;
    let ast: SyntaxNode;
    try { ast = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: mode }) as unknown as SyntaxNode; }
    catch { throw new WebPackageRenderError(`JavaScript 无法按 browser-ready ${mode} 解析：${base}`); }
    const edits: {start: number; end: number; text: string}[] = [];
    const visit = (node: SyntaxNode) => {
      if (node.type === 'MetaProperty' && (node.meta as { name?: string })?.name === 'import') {
        edits.push({ start: node.start, end: node.end, text: `globalThis.__MAHO_WEB_PACKAGE__.meta(${JSON.stringify(base)})` }); return;
      }
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
        const literal = node.source as SyntaxNode;
        const found = resolveModule(String(literal.value), base); ensureModule(found);
        edits.push({ start: literal.start, end: literal.end, text: JSON.stringify(found.url) });
      }
      if (node.type === 'ImportExpression') {
        const literal = node.source as SyntaxNode;
        // 动态字面量也预建含 query/hash 的模块身份；表达式只能读取预建模块，不转发未知包内 URL。
        if (literal.type === 'Literal' && typeof literal.value === 'string') {
          const found = resolveModule(literal.value, base); ensureModule(found);
          edits.push({ start: literal.start, end: literal.end, text: JSON.stringify(found.url) });
        }
        edits.push({ start: node.start, end: node.start + 6, text: `globalThis.__MAHO_WEB_PACKAGE__.importFrom.bind(null,${JSON.stringify(base)})` });
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) { if (child && typeof child === 'object' && 'type' in child) visit(child as SyntaxNode); }
        else if (value && typeof value === 'object' && 'type' in value) visit(value as SyntaxNode);
      }
    };
    visit(ast);
    let output = source;
    for (const edit of edits.sort((a,b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    return output;
  }
  let inlineNumber = 0;
  walkHtml(document, node => {
    const tag = node.tagName.toLowerCase();
    if (tag === 'base') { remove(node); return; }
    if (tag === 'meta' && attr(node,'http-equiv')?.toLowerCase() === 'refresh') {
      remove(node); diagnostics.add('自动页面刷新未启用；请使用同文档交互。'); return;
    }
    if (tag === 'style') {
      const css = rewriteCss(textContent(node), entry); const media = attr(node,'media');
      node.nodeName = node.tagName = 'link'; node.childNodes = []; node.attrs = [];
      setAttr(node,'rel','stylesheet'); setAttr(node,'href',dataUrl(encoder.encode(css),'text/css')); if (media) setAttr(node,'media',media);
      return;
    }
    if (attr(node,'style')) setAttr(node,'style',rewriteCss(attr(node,'style')!,entry,true));
    if (tag === 'script') {
      const type = (attr(node,'type') ?? '').trim().toLowerCase();
      if (type && type !== 'module' && !jsType(type)) return; // JSON / data blocks remain inert.
      const src = attr(node,'src'); const found = src ? resolve(src, entry) : null;
      if (found?.external) return; // 远端字节不由宿主读取或改写。
      if (found && !jsType(files[found.path].mediaType)) throw new WebPackageRenderError(`脚本 MIME 不匹配：${found.path}`);
      const source = found && !found.external ? readText(found.path) : textContent(node);
      const base = found?.url ?? entry;
      dropAttr(node,'integrity'); dropAttr(node,'crossorigin');
      if (type === 'module') {
        const id = found?.url ?? `${entry}?__maho_inline=${inlineNumber++}`;
        if (found) ensureModule(found); else modules[id] = { code: rewriteJavaScript(source,entry,'module'), mediaType:'text/javascript' };
        dropAttr(node,'src'); setText(node,`import ${JSON.stringify(id)};`);
      } else {
        setAttr(node,'src',dataUrl(encoder.encode(rewriteJavaScript(source,base,'script')),'text/javascript')); setText(node,'');
        if (!src) { dropAttr(node,'async'); dropAttr(node,'defer'); }
      }
      return;
    }
    for (const attribute of [...node.attrs]) {
      const name = attribute.name;
      const mediaRef = name === 'src' && ['img','audio','video','source','track','input'].includes(tag)
        || name === 'poster' && tag === 'video'
        || name === 'href' && ['link','image','use'].includes(tag);
      if (mediaRef) {
        const original = attribute.value;
        attribute.value = asset(original, entry);
        // 本地 CSS 已重写相对引用，原 SRI 不再描述这些展示字节；原包仍由 digest 校验。
        if (tag === 'link' && attribute.value !== original && attribute.value.startsWith('data:')) {
          dropAttr(node, 'integrity');
          dropAttr(node, 'crossorigin');
        }
      }
      if (name === 'srcset' && ['img','source'].includes(tag)) attribute.value = rewriteSrcset(attribute.value, value=>asset(value,entry));
    }
    if (tag === 'a') {
      const href = attr(node,'href');
      if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/iu.test(href) && !href.startsWith('//')) {
        const found = resolve(href,entry);
        if (!found.external && found.path === instance.base.manifest.entry && found.hash) setAttr(node,'href',found.hash);
        else if (!found.external && attr(node,'download') !== undefined) setAttr(node,'href',asset(href,entry));
        else if (!found.external) { dropAttr(node,'href'); setAttr(node,'title','请使用同文档 hash 路由；当前未提供多文档导航'); diagnostics.add('包内多文档导航尚不支持；同文档 hash 路由仍可使用。'); }
      }
    }
    if (tag === 'iframe' || tag === 'object' || tag === 'embed') diagnostics.add('嵌套页面与插件由运行页策略禁用。');
  });
  // 为计算式 import('./'+name+'.js') 预建包内标准模块；未用到的经典脚本不因 module 解析失败阻塞页面。
  for (const [path, type] of descriptors) if (jsType(type) && !moduleFailures.has(fileUrl(path))) {
    try { ensureModule(resolve(fileUrl(path), entry)); } catch { /* 真正引用时给出明确模块错误。 */ }
  }
  const scripts: Record<string, string> = Object.create(null);
  for (const [path, type] of descriptors) if (jsType(type)) {
    try { scripts[path] = dataUrl(encoder.encode(rewriteJavaScript(readText(path), fileUrl(path), 'script')), type); }
    catch { /* ESM 由模块表解析；未执行的其他脚本不应阻断入口。 */ }
  }
  const styles: Record<string, string> = Object.create(null);
  for (const [path, type] of descriptors) if (type === 'text/css') {
    try { styles[path] = cssFile(path); } catch { diagnostics.add(`未引用样式无法提前物化：${path}`); }
  }
  let head: Element | undefined;
  walkHtml(document, node => { if (node.tagName === 'head') head = node; });
  if (!head) throw new WebPackageRenderError('Web 包入口缺少 HTML head');
  const baseNode = element('base'); setAttr(baseNode,'href',entry); baseNode.parentNode=head;
  const bootstrap = element('script'); bootstrap.parentNode=head;
  const plan = JSON.stringify({ root,entry,files,modules,styles,scripts,importAliases }).replace(/</gu,'\\u003c').replace(/\u2028/gu,'\\u2028').replace(/\u2029/gu,'\\u2029');
  setText(bootstrap, WEB_PACKAGE_BOOTSTRAP + plan + ');');
  head.childNodes.unshift(baseNode,bootstrap);
  return { kind:'srcdoc',html:serialize(document),diagnostics:[...diagnostics] };
}

/** WHATWG srcset 风格词法读取：不把 data URL 中的逗号当作候选分隔符。 */
function rewriteSrcset(input: string, resolve: (_value: string) => string): string {
  let index=0; const output: string[]=[];
  while(index<input.length) {
    while(/[\s,]/u.test(input[index]??'') && index<input.length) index++;
    const start=index; while(index<input.length && !/\s/u.test(input[index])) index++;
    let url=input.slice(start,index); if(!url) break;
    const ended=url.endsWith(','); url=url.replace(/,+$/u,'');
    let description='';
    if(!ended) { const begin=index; let depth=0; while(index<input.length) {const c=input[index];if(c===','&&depth===0)break;if(c==='(')depth++;if(c===')')depth--;index++;} description=input.slice(begin,index).trim(); }
    if(input[index]===',')index++;
    output.push(resolve(url)+(description?' '+description:''));
  }
  return output.join(', ');
}
