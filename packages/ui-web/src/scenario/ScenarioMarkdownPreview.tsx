import { useMemo, useState, type ReactNode } from 'react';
import { WrapText } from 'lucide-react';

import { GenerationActionButton } from '../generation-actions';
import { MarkdownBlock, type MarkdownBlockVariant } from '../markdown';

/**
 * 只为整段疑似多转义的 Markdown 提供可撤回的阅读候选，不修复数据。
 * 混合真实换行、代码、JSON、链接、路径或其他转义时不猜测用户意图。
 */
export function escapedScenarioPreview(content: string): string | null {
  const source = content.trim();
  if (!/^#{1,6} /.test(source) || /[\r\n`{}\[\]"$]|~~~|[A-Za-z]:\\/.test(source)) return null;
  const lf = source.replace(/\\r\\n/g, '\\n');
  if (lf.replace(/\\n/g, '').includes('\\') || /\\n(?: {4}|\t)/.test(lf)) return null;
  if ((lf.match(/\\n\\n/g)?.length ?? 0) < 2) return null;
  if (!/\\n\\n(?:#{1,6} |---(?:\\n|$)|[-*+] )/.test(lf)) return null;
  return lf.replace(/\\n/g, '\n');
}

export interface ScenarioMarkdownPreviewProps {
  readonly content: string;
  readonly variant?: MarkdownBlockVariant;
  readonly renderMarkdown?: (content: string) => ReactNode;
}

function Preview({ content, variant = 'light', renderMarkdown }: ScenarioMarkdownPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const candidate = useMemo(() => escapedScenarioPreview(content), [content]);
  const display = expanded && candidate !== null ? candidate : content;
  return <div>
    {candidate !== null && <div data-scenario-preview-controls className="mb-3 space-y-2">
      <p className="text-sm text-(--app-text-muted)">检测到疑似转义换行。仅调整显示，JSON 原件不变；图片导出使用当前预览。</p>
      <GenerationActionButton aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>
        <WrapText aria-hidden="true" className="h-4 w-4" />
        {expanded ? '恢复原文预览' : '按换行预览'}
      </GenerationActionButton>
    </div>}
    {renderMarkdown ? renderMarkdown(display) : <MarkdownBlock content={display} variant={variant} mode="article" />}
  </div>;
}

/** 内容替换即回到原文；阅读选择不进入草稿、签名或任何宿主写入回调。 */
export function ScenarioMarkdownPreview(props: ScenarioMarkdownPreviewProps) {
  return <Preview key={props.content} {...props} />;
}
