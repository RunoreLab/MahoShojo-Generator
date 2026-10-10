/** Web runner 的固定响应策略；iframe sandbox 与父页继承政策仍由 Web 宿主施加。 */
export const WEB_PACKAGE_RUNNER_POLICY = [
  "default-src 'none'", "base-uri https://web-package.invalid", "frame-ancestors 'self'",
  "script-src 'unsafe-inline' blob: data: https:", "script-src-attr 'unsafe-inline'",
  "style-src 'unsafe-inline' data: blob: https:", "img-src data: blob: https:",
  "font-src data: blob: https:", "media-src data: blob: https:",
  "connect-src https: wss: data: blob:", "frame-src 'none'", "object-src 'none'",
  "worker-src 'none'", "form-action 'none'", "manifest-src 'none'",
].join('; ');
