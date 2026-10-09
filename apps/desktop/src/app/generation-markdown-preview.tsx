import { MarkdownBlock, type MarkdownPlugin } from '@mahoshojo/ui-web/markdown';

/** MarkdownBlock 的相对路径链接也可能生成原生 anchor；预览只读，不允许导航。 */
const disablePreviewLinks: MarkdownPlugin = () => (tree: unknown) => {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as { tagName?: string; properties?: Record<string, unknown>; children?: unknown[] };
    if (node.tagName === 'a') {
      node.tagName = 'span';
      node.properties = {};
    }
    node.children?.forEach(visit);
  };
  visit(tree);
};
const previewRehypePlugins = [disablePreviewLinks];

/** 只展示本次流式生成的正文；外部媒体沿用 MarkdownBlock 缺省拒绝策略。 */
export function GenerationMarkdownPreview({ active, text }: { active: boolean; text: string }) {
  if (!active || !text.trim()) return null;
  return (
    <section aria-label="流式正文预览" aria-busy="true" className="mt-4 rounded-lg border border-(--app-border) bg-(--app-surface) p-4">
      <p className="mb-3 text-sm text-(--app-text-muted)">正在生成 · 正文预览</p>
      <MarkdownBlock
        content={text}
        variant="light"
        mode="article"
        rehypePlugins={previewRehypePlugins}
        // 行内百科代码在渲染期间才转成内部链接，单独保持只读。
        renderInternalLink={({ children }) => <span>{children}</span>}
      />
    </section>
  );
}
