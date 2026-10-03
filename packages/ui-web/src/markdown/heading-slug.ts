/**
 * Heading slug。
 *
 * ## 为什么不直接用 `rehype-slug`
 *
 * 两个理由，都不是"不想加依赖"这么随便：
 *
 * 1. **它会对所有 heading 无条件写 `id`**，而本包的 `MarkdownBlock` 同时服务百科（仓库内受审内容）、
 *    竞技场战报与魔法茶会（AI 生成 + 用户输入）。`rehype-slug` 自己的 README 明确提示 heading `id`
 *    带来 DOM clobbering 风险、面向不可信内容应配 sanitize。把一个安全面更大的默认行为强加给所有
 *    调用方，不是本切片该做的事。因此 heading id 改为 `headingIds?: false | 'github'` 显式 opt-in
 *    （`D3.0-5`）。
 * 2. **`id` 必须落在渲染层，不能由 `h1 → h2` 的 component 映射推导。** article 模式把标题整体下移
 *    一级（`MarkdownBlock` 的既有行为），如果 id 跟着映射走，同一个标题在 compact 与 article 两种
 *    模式下会得到不同的锚点。id 由**源文本**决定，与渲染成哪个标签无关，锚点才稳定。
 *
 * ## 算法范围
 *
 * 这是 GitHub 风格的 slug（小写、标点剔除、空格转连字符、同名追加 `-1`），**不是** `github-slugger`
 * 的逐位兼容实现，因此不声称与 GitHub 完全一致——那需要引入该依赖并承担它的传递依赖。这里需要
 * 满足的是本仓自己的验收口径：中文标题可用、同名标题不冲突、结果可直接放进 URL fragment。
 */

/**
 * 单个标题文本的 slug。
 *
 * 保留 CJK、字母、数字、连字符与下划线，其余（含空格与标点）折叠成单个连字符。
 */
export const slugifyHeading = (text: string): string => {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]+/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  // 全部字符都被剔除时（例如标题只有 emoji）会产生空 slug，而空 id 会让页面里第一个元素变成
  // fragment 目标。退回一个稳定占位比留空更安全。
  return slug === '' ? 'section' : slug;
};

/**
 * 一组标题的 slug 分配器。
 *
 * 同名标题必须得到不同 slug（`foo`、`foo-1`…），否则条目页里两个同名小节会共用一个锚点，链接到
 * 第二个时浏览器会滚到第一个。用闭包而不是纯函数，是为了让「同一篇文章内的重名消解」这一上下文
 * 在多次调用之间保持——每次调用都新建一个分配器就等于没有消解。
 */
export const createHeadingSlugger = (): ((text: string) => string) => {
  const seen = new Map<string, number>();

  return (text: string) => {
    const base = slugifyHeading(text);
    const used = seen.get(base) ?? 0;
    seen.set(base, used + 1);
    return used === 0 ? base : `${base}-${used}`;
  };
};

/**
 * 从 URL fragment 解出元素 id。
 *
 * fragment 是 URL 的一部分而不是文件名：浏览器写入 fragment 时会做 percent-encoding，因此
 * `location.hash` 可能是 `#%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90`。而 slug 本身也可能含需要编码的
 * 字符。解码失败必须返回原值而不是抛错——一个指向不存在节点的链接是死链，抛错则是白屏。
 */
export const decodeFragmentId = (fragment: string): string => {
  const withoutHash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (withoutHash === '') return '';

  try {
    return decodeURIComponent(withoutHash);
  } catch {
    return withoutHash;
  }
};