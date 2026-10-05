/**
 * 仅在获得普通 Web 执行许可后的 iframe 内运行。纯字符串避免构建器把闭包辅助函数移出序列化边界。
 * 文件表是此实例的只读资源，不提供宿主 RPC，不在父页面执行创作者代码。
 */
export const WEB_PACKAGE_BOOTSTRAP = String.raw`(function (plan) {
  'use strict';
  var root = plan.root;
  var entry = plan.entry;
  var origin = new URL(root).origin;
  var blobs = [];
  var imports = Object.create(null);
  var decoded = Object.create(null);
  var metadata = Object.create(null);
  var nativeFetch = globalThis.fetch.bind(globalThis);
  function locate(value, base) {
    var url = new URL(String(value), base || entry);
    if (url.origin !== origin) return { external: true, url: url.href };
    if (!url.href.startsWith(root)) throw new Error('包内路径越界');
    var path = decodeURIComponent(url.pathname.slice(new URL(root).pathname.length));
    return { external: false, path: path, url: url.href, hash: url.hash };
  }
  function bytes(path) {
    if (!Object.prototype.hasOwnProperty.call(plan.files, path)) return null;
    if (!decoded[path]) {
      var binary = atob(plan.files[path].base64);
      decoded[path] = Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
    }
    return decoded[path];
  }
  function asset(value, base, module, script) {
    if (!value || String(value).startsWith('#')) return value;
    var found = locate(value, base);
    if (found.external) return found.url;
    if (module && imports[found.url]) return imports[found.url];
    if (script && !module && plan.scripts[found.path]) return plan.scripts[found.path];
    if (!Object.prototype.hasOwnProperty.call(plan.files, found.path)) throw new Error('Web 包资源不存在：' + found.path);
    if (plan.styles[found.path]) return plan.styles[found.path] + found.hash;
    var file = plan.files[found.path];
    if (!file) throw new Error('Web 包资源不存在：' + found.path);
    return 'data:' + file.mediaType + ';base64,' + file.base64 + found.hash;
  }
  Object.keys(plan.modules).forEach(function (url) {
    var module = plan.modules[url];
    var blob = URL.createObjectURL(new Blob([module.code], { type: module.mediaType }));
    blobs.push(blob); imports[url] = blob;
  });
  var importMap = document.createElement('script');
  importMap.type = 'importmap';
  importMap.textContent = JSON.stringify({ imports: imports });
  document.head.appendChild(importMap);
  function locateModule(value, base) {
    value = String(value);
    var alias = Object.keys(plan.importAliases).sort(function (a,b) { return b.length-a.length; }).find(function (key) { return key === value || key.endsWith('/') && value.startsWith(key); });
    if (alias) value = plan.importAliases[alias] + (alias.endsWith('/') ? value.slice(alias.length) : '');
    return locate(value, base);
  }
  var helpers = {
    importFrom: function (base, value, options) {
      try {
        var found = locateModule(value, base);
        if (!found.external && !imports[found.url]) return Promise.reject(new Error('未准备的本地模块：' + found.url));
        return import(found.url, options);
      } catch (error) { return Promise.reject(error); }
    },
    meta: function (url) {
      if (!metadata[url]) {
        metadata[url] = Object.assign(Object.create(null), { url: url,
          resolve: function (value) { return locateModule(value, url).url; } });
      }
      return metadata[url];
    },
    resourceURL: asset
  };
  Object.defineProperty(globalThis, '__MAHO_WEB_PACKAGE__', { value: helpers, configurable: false });
  globalThis.fetch = function (input, init) {
    var found;
    try { found = locate(input instanceof Request ? input.url : input, entry); }
    catch (_) { return Promise.resolve(new Response('Not Found', { status: 404 })); }
    if (found.external) return nativeFetch(input, init);
    var signal = (init && init.signal) || (input instanceof Request ? input.signal : null);
    if (signal && signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    var method = String((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return Promise.resolve(new Response('Method Not Allowed', { status: 405 }));
    var payload = bytes(found.path);
    if (!payload) return Promise.resolve(new Response('Not Found', { status: 404 }));
    var result = new Response(method === 'HEAD' ? null : payload.slice(), {
      status: 200, headers: { 'Content-Type': plan.files[found.path].mediaType, 'X-Content-Type-Options': 'nosniff' }
    });
    Object.defineProperty(result, 'url', { value: found.url });
    return Promise.resolve(result);
  };
  // 异步 XHR 的包内 GET 复用浏览器原生 data URL 解码，不代取宿主资源。
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    var found = locate(url, entry);
    if (!found.external) {
      if (String(method).toUpperCase() !== 'GET') throw new Error('包内 XHR 只支持 GET');
      args[1] = asset(url, entry);
    }
    return xhrOpen.apply(this, args);
  };
  var setAttribute = Element.prototype.setAttribute;
  var resourceTags = /^(IMG|AUDIO|VIDEO|SOURCE|TRACK|SCRIPT|INPUT|IMAGE|USE)$/;
  function mapAttribute(element, name, value) {
    if ((name === 'src' && resourceTags.test(element.tagName.toUpperCase())) || name === 'poster'
      || (name === 'href' && /^(LINK|IMAGE|USE)$/i.test(element.tagName))) {
      return asset(value, entry, element.tagName === 'SCRIPT' && element.type === 'module', element.tagName === 'SCRIPT');
    }
    return value;
  }
  Element.prototype.setAttribute = function (name, value) {
    return setAttribute.call(this, name, mapAttribute(this, String(name).toLowerCase(), value));
  };
  // 原生属性 setter 不调用 JS setAttribute；单独处理常见运行时媒体加载。
  [[HTMLImageElement,'src'],[HTMLMediaElement,'src'],[HTMLSourceElement,'src'],[HTMLScriptElement,'src'],
    [HTMLLinkElement,'href'],[HTMLVideoElement,'poster']].forEach(function (pair) {
    var descriptor = Object.getOwnPropertyDescriptor(pair[0].prototype, pair[1]);
    if (!descriptor || !descriptor.set || !descriptor.configurable) return;
    Object.defineProperty(pair[0].prototype, pair[1], Object.assign({}, descriptor, {
      set: function (value) { return descriptor.set.call(this, mapAttribute(this, pair[1], value)); }
    }));
  });
  document.addEventListener('click', function (event) {
    var anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var href = anchor.getAttribute('href');
    if (href && href.startsWith('#')) {
      event.preventDefault(); location.hash = href;
      try { var target = document.getElementById(decodeURIComponent(href.slice(1))); if (target) target.scrollIntoView(); } catch (_) {}
    }
  });
  addEventListener('pagehide', function (event) { if (!event.persisted) blobs.forEach(function (url) { URL.revokeObjectURL(url); }); });
})(`;
