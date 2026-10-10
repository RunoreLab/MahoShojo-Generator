import { WEB_PACKAGE_RUNNER_POLICY } from '@mahoshojo/web-package/runner-policy';

export { WEB_PACKAGE_RUNNER_POLICY };

export { WEB_PACKAGE_RUNNER_PATH } from './runner-client';
export const WEB_PACKAGE_RUNNER_HEADERS = [
  { key: 'Content-Security-Policy', value: WEB_PACKAGE_RUNNER_POLICY },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Permissions-Policy', value: "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), serial=(), display-capture=()" },
] as const;

// 此页没有用户字节、会话/API 能力或可持久执行资源。只接收当前父窗口的一次性、匹配 nonce 的内容投递。
export const WEB_PACKAGE_RUNNER_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Web 包运行页</title></head><body><p>等待本地 Web 包…</p><script>
(function () {
  'use strict';
  if (parent === window) { document.body.textContent = '请从竞技场打开 Web 包。'; return; }
  var origin = new URL(location.href).origin;
  var nonce = new URLSearchParams(location.search).get('instance');
  if (!nonce || !/^[a-zA-Z0-9_-]{16,100}$/.test(nonce)) return;
  function receive(event) {
    if (event.source !== parent || event.origin !== origin || !event.data || event.data.type !== 'maho-web-package:mount' || event.data.nonce !== nonce || typeof event.data.html !== 'string') return;
    removeEventListener('message', receive);
    document.open(); document.write(event.data.html); document.close();
  }
  addEventListener('message', receive);
  parent.postMessage({ type: 'maho-web-package:ready', nonce: nonce }, origin);
})();
</script></body></html>`;
