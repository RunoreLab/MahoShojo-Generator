import type { useRouter } from '@tanstack/react-router';

/**
 * 从 hash history 的原始 hash 里取出 fragment。
 *
 * ## 为什么需要它
 *
 * Desktop 用 `createHashHistory`，因此 URL 形如 `#/encyclopedia/site-guide#角色生成`——路由与
 * fragment 共处同一个 `#`。而 `@tanstack/react-router` 解析后的 `location` **没有** `hash` 字段
 * （实测 `router.state.location.hash` 为 `undefined`），只有 `pathname` / `search`。
 *
 * 宿主从订阅的 `router.state.location.href`（`/route#anchor`）读取；本函数也接受原始
 * `window.location.hash`（`#/route#anchor`）。两者都包含路由，不能直接喂给
 * `getElementById`——否则查的是 `"/encyclopedia/site-guide#角色生成"` 这个不存在的 id。
 *
 * ## 为什么不用通用 URL 解析
 *
 * `new URL()` 会把 hash history 的 `#/route` 当成 fragment，解析不出路由部分。这里需要的恰恰是
 * 反过来：先认出"第一个 `#` 之后是路由"，再取"第二个 `#` 之后才是 fragment"。
 *
 * 返回值保持 percent-encoded 原样。共享层的 `decodeFragmentId` 负责解码且在解码失败时回退到原值，
 * 因此这里不需要、也不应该猜编码。
 */
export const getRouteFragmentFromHashHistory = (rawHash: string | undefined): string => {
  if (typeof rawHash !== 'string' || rawHash === '') return '';

  const withoutLeadingHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const separatorIndex = withoutLeadingHash.indexOf('#');
  return separatorIndex < 0 ? '' : withoutLeadingHash.slice(separatorIndex + 1);
};

/**
 * 把共源组件渲染 `<a href>` 用的产品路径解析成 hash history 下的运行时 href。
 *
 * 共源层只认识 `/encyclopedia/foo` 这类产品路径；hash history 宿主的地址栏真实形态是
 * `#/encyclopedia/foo`。导航回调始终走产品路径，本函数只补 `href` 属性——否则「复制链接」
 * 或脚本失败后的原生跳转会落在不存在的裸路径上。
 *
 * 只接受 `/` 开头的产品路径：其余形态原样透传（协议相对、mailto、裸相对路径等），
 * 不会把 `#` 前缀加到本来就不是站内路由的东西上。同页锚点 `#frag` 是特例——它在
 * hash history 下不是合法地址（裸 `#frag` 会被当成名为 frag 的路由），因此拼出
 * `#<当前路由>#frag` 的完整形态；当前路由从 `window.location.hash` 现取，是一次性
 * 渲染快照——精确导航仍由 `navigateByProductHref` 在点击时完成。
 */
export const resolveInternalHrefForHashHistory = (href: string): string => {
  if (href.startsWith('#')) {
    if (typeof window === 'undefined') return href;
    const route = window.location.hash.slice(1).split('#')[0] ?? '';
    return `#${route === '' ? '/' : route}${href}`;
  }
  if (!href.startsWith('/')) return href;
  return `#${href}`;
};

export type ProductHrefNavigateOptions = {
  /** `true` 时替换当前历史条目而不是新增——筛选写回 URL 这类高频改动应使用。 */
  readonly replace?: boolean;
  /**
   * `true` 时不做滚动复位——搜索输入这类同页高频改动不应把页面滚回顶部。
   * 缺省时路径跳转恢复 Web `<Link>` 的默认语义：回到页面顶部从头阅读。
   */
  readonly preserveScroll?: boolean;
};

type DesktopRouter = ReturnType<typeof useRouter>;

/**
 * 把共源视图回传的产品 href 喂给 hash router。
 *
 * 共源层只产出 `/encyclopedia?q=x`、`/encyclopedia/foo#锚点`、同页 `#锚点` 这类字符串；
 * `router.navigate` 需要结构化参数——整串塞进 `to` 会让 `?`/`#` 后缀被当成 pathname 的
 * 一部分静默丢失或 404。这里统一拆分：
 *
 * - `/path?query#frag` → `{ to, search, hash }`；
 * - 纯 `#frag` 同页锚点 → 留在当前路由只改 fragment（`search: true` 保留现有 query）。
 *
 * 所有「共源回调吐 href、宿主执行跳转」的装配点都应走这里，而不是各自再写一遍拆分。
 */
export const navigateByProductHref = (
  router: DesktopRouter,
  href: string,
  options?: ProductHrefNavigateOptions,
): void => {
  const hashIndex = href.indexOf('#');
  const beforeHash = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? undefined : href.slice(hashIndex + 1);
  const replace = options?.replace === true;

  if (beforeHash === '') {
    void router.navigate({ to: '.', search: true, hash: fragment ?? '', replace });
    return;
  }

  const queryIndex = beforeHash.indexOf('?');
  const to = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex);
  const search =
    queryIndex < 0 ? {} : Object.fromEntries(new URLSearchParams(beforeHash.slice(queryIndex + 1)));
  const navigation = router.navigate({
    to,
    search,
    ...(fragment !== undefined ? { hash: fragment } : {}),
    replace,
  });
  // TanStack 不托管滚动：路径级跳转须显式回到顶部，否则在长百科底部切条目会停在旧纵深。
  // 同页 `#frag` 与 `preserveScroll` 的筛选写回已在上面分流；带 fragment 的跨页跳转随后由
  // `useHashScrollTarget` 把目标 heading 滚进视野，先回顶部是它生效前的正确兜底位置。
  if (options?.preserveScroll !== true && typeof window !== 'undefined') {
    void navigation.then(
      () => window.scrollTo(0, 0),
      () => undefined,
    );
  }
};