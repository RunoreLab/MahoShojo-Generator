/**
 * 共源百科的正文寻址。
 *
 * ## 这里只有一个可变的部分：base URL
 *
 * 共享代码不知道也不该知道正文被伺服在哪里。两个宿主当前都是 origin 根（Web 由 `public/` 提供、
 * Desktop 由 Tauri 自定义协议伺服 `dist/`），但那是**当前事实**，不是可以写死的约定——Tauri 的
 * origin、部署子路径或将来的资源隔离都可能改变它。因此它由宿主注入，而不是在这里推断。
 *
 * ## 为什么不注入 fetch
 *
 * `fetch` 是 Web 标准，两个宿主都有，注入它只会多一层没有换来任何东西的间接。真正需要注入的是
 * 「资源在哪」，因为那是宿主事实。
 *
 * ## 为什么不写死 `/encyclopedia/`
 *
 * 目录前缀与 base 分离，才可能把整个百科挪到另一个前缀下而不动 52 条目录数据。`tests/` 对两种前缀
 * 各断言一次，防止有人后来把前缀合回 base。
 */

/** 宿主提供的百科正文服务根，例如 `/` 或 `/app/`。 */
export interface EncyclopediaContentSource {
  readonly baseUrl: string;
}

const joinBase = (baseUrl: string, relativePath: string): string => {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${base}${suffix}`;
};

/** 目录下所有正文共用的前缀。它与 base 分离，便于整体迁移目录。 */
export const ENCYCLOPEDIA_CONTENT_PREFIX = '/encyclopedia';

/** 条目正文的最终 URL。 */
export const encyclopediaContentUrl = (
  source: EncyclopediaContentSource,
  contentFile: string,
): string => joinBase(source.baseUrl, `${ENCYCLOPEDIA_CONTENT_PREFIX}/${contentFile}`);