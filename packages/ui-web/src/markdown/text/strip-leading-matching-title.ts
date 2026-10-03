/**
 * 剥离与外层标题重复的首个 H1。
 *
 * ## 它不是 hack，而是内容约定
 *
 * 53 篇百科正文都可以被单独阅读，因此它们各自带一个 H1；而条目页在正文之前已经渲染了自己的标题。
 * 两者同时出现就是页面顶部连着两个同名标题。这里的判据是「**正文首个 H1 与页面标题相同才剥**」——
 * 不相同就都留着，因为那说明正文标题与目录标题是有意不同的两件事（当前有 7 篇属于这种情况），
 * 强行按位置剥离会丢掉正文真正的标题。
 *
 * 把它做成共享纯函数而不是就地内联，是因为 Desktop 将来会有同样的页面，而"什么时候剥、什么时候不剥"
 * 是一条需要被测试固定的产品规则，不该在两端各写一遍。
 */

export interface StripLeadingMatchingTitleInput {
  /** 已取回的 Markdown 正文。 */
  readonly content: string;
  /** 外层页面展示的标题。 */
  readonly title: string;
}

export const stripLeadingMatchingTitle = ({
  content,
  title,
}: StripLeadingMatchingTitleInput): string => {
  const normalizedTitle = title.trim();
  if (normalizedTitle === '') return content;

  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const heading = lines[0]?.trim().match(/^#\s+(.*)$/)?.[1]?.trim() ?? '';

  if (heading !== normalizedTitle) return content;

  let startIndex = 1;
  while (startIndex < lines.length && lines[startIndex]?.trim() === '') startIndex += 1;
  return lines.slice(startIndex).join('\n');
};