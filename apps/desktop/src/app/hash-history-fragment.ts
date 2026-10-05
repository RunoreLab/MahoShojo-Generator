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