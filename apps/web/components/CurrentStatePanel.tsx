// canonical 实现在 @mahoshojo/ui-web/character-card；本文件注入 Web 的 MarkdownBlock。

import { CurrentStatePanel as SharedCurrentStatePanel, type CurrentStatePanelProps } from '@mahoshojo/ui-web/character-card';

import { MarkdownBlock } from '@/components/MarkdownBlock';

export type { CurrentStatePanelProps };

export function CurrentStatePanel(props: CurrentStatePanelProps) {
  return <SharedCurrentStatePanel {...props} Markdown={MarkdownBlock} />;
}
