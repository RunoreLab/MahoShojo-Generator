// canonical 实现在 @mahoshojo/ui-web/character-card；本文件注入 Web 的 MarkdownBlock。

import { InlineField as SharedInlineField, type InlineFieldProps } from '@mahoshojo/ui-web/character-card';

import { MarkdownBlock } from '@/components/MarkdownBlock';

export type { InlineFieldProps };

export function InlineField(props: InlineFieldProps) {
  return <SharedInlineField {...props} Markdown={MarkdownBlock} />;
}
