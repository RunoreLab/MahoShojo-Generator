import { WEB_PACKAGE_RUNNER_HEADERS, WEB_PACKAGE_RUNNER_HTML } from '@/lib/web-package/runner';

/** 不接收上传、不持久化包；包内容只在浏览器父子窗口间传递。 */
export function GET(): Response {
  return new Response(WEB_PACKAGE_RUNNER_HTML, {
    headers: { ...Object.fromEntries(WEB_PACKAGE_RUNNER_HEADERS.map(({ key, value }) => [key, value])),
      'Content-Type': 'text/html; charset=utf-8' },
  });
}
