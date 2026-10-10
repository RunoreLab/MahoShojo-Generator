/** Native 专用 transport adapter；Web client 不能经通用入口导入本模块。 */
import { RESTRICTED_FREE_HTML_POLICY } from './execution-policy';
import { WEB_PACKAGE_RUNNER_POLICY } from './runner-policy';

/**
 * Native 自定义协议在各 WebView 中的两个固定资源来源；不是可配置网络白名单。
 * 来源内的跨 instance 请求仍必须由 resolver 的 label / instance 钉定拒绝。
 */
export const DESKTOP_WEB_RESOURCE_ORIGINS = Object.freeze([
  'maho-webpkg://localhost',
  'http://maho-webpkg.localhost',
] as const);

// 仅给实际资源加载点添加本地 transport，绝不能向 `*-src 'none'` 机械追加来源。
const LOCAL_RESOURCE_DIRECTIVES = new Set([
  'script-src', 'style-src', 'img-src', 'font-src', 'media-src', 'connect-src',
]);

const adaptDesktopPolicy = (policy: string, isPackage: boolean): string => {
  const origins = DESKTOP_WEB_RESOURCE_ORIGINS.join(' ');
  const directives = policy.split('; ').map((directive) => {
    const name = directive.split(' ', 1)[0];
    if (LOCAL_RESOURCE_DIRECTIVES.has(name)) return `${directive} ${origins}`;
    // 独立窗口不接受 frame 祖先；包中显式 <base> 只能使用固定 transport。
    if (name === 'frame-ancestors') return "frame-ancestors 'none'";
    if (name === 'base-uri') return isPackage ? `base-uri ${origins}` : `${directive} ${origins}`;
    return directive;
  });
  // Web 生产父页的 insecure-request policy 会影响嵌套 runner；Native 无该父页。
  // 保留生产等效 UIR；可信 localhost transport 的真实 WebView2 行为仍需实机验证。
  if (!directives.includes('upgrade-insecure-requests')) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
};

/**
 * 供生成器消费的固定 policy manifest。Native 必须另行追加不可移除的
 * `sandbox allow-scripts`，不能把 renderer 字符串或包 manifest 当成此对象。
 */
export const DESKTOP_WEB_EXECUTION_POLICIES = Object.freeze({
  'free-html': adaptDesktopPolicy(RESTRICTED_FREE_HTML_POLICY, false),
  'web-package': adaptDesktopPolicy(WEB_PACKAGE_RUNNER_POLICY, true),
});
