/**
 * 不可信 Web 内容运行策略的浏览器中立 owner。
 *
 * 自由 HTML 在 Web srcdoc 中继承父页 CSP，Web 主站环境仍选择其 dev / 可选集成参数；
 * Web 包使用固定 runner 策略。两者不合并为更宽的通用 HTTPS 脚本白名单。
 * 此模块不读取环境/存储，不提供同源授权或 Native capability，也不创建执行入口。
 */
export type WebPageContentSecurityPolicyOptions = Readonly<{
  allowCloudflareInsights?: boolean;
  allowGoogleAnalytics?: boolean;
  allowTurnstile?: boolean;
  isProduction: boolean;
}>;

export function buildWebPageContentSecurityPolicy(options: WebPageContentSecurityPolicyOptions): string {
  const scriptSources = [`'self'`, `'unsafe-inline'`];
  const connectSources = [`'self'`, 'https:', 'wss:'];
  const frameSources = [`'self'`];

  if (!options.isProduction) {
    scriptSources.push(`'unsafe-eval'`);
    connectSources.push('http:', 'ws:');
  }

  if (options.allowTurnstile) {
    scriptSources.push('https://challenges.cloudflare.com');
    frameSources.push('https://challenges.cloudflare.com');
  }

  if (options.allowCloudflareInsights) {
    scriptSources.push('https://static.cloudflareinsights.com');
  }

  if (options.allowGoogleAnalytics) {
    scriptSources.push('https://www.googletagmanager.com');
    connectSources.push('https://www.google-analytics.com', 'https://region1.google-analytics.com');
  }

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `script-src ${Array.from(new Set(scriptSources)).join(' ')}`,
    `script-src-attr 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src ${Array.from(new Set(connectSources)).join(' ')}`,
    `media-src 'self' data: blob: https:`,
    `frame-src ${Array.from(new Set(frameSources)).join(' ')}`,
    `manifest-src 'self'`,
    `worker-src 'self' blob:`,
  ];

  if (options.isProduction) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Desktop 自由 HTML 的生产基线。宿主只会在后继生成阶段适配固定包内资源来源；
 * 不携带 Web HMR 或可选主站集成脚本，不把 CSP 文本当作 renderer 可传入的配置。
 * 当前只是共源规则，不表示 Desktop 产品运行已经开放。
 */
export const RESTRICTED_FREE_HTML_POLICY = buildWebPageContentSecurityPolicy({ isProduction: true });
