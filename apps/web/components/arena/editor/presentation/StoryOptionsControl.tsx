'use client';

import type { ComponentProps } from 'react';

import { StoryOptionsPanel } from '@/components/shared/StoryOptionsPanel';

type StoryOptionsPanelProps = ComponentProps<typeof StoryOptionsPanel>;

export type StoryOptionsControlProps = Omit<StoryOptionsPanelProps, 'isGenerating'> & {
  disabled?: boolean;
};

/**
 * 只承载房间可共享的故事选项。AI Provider 属于房主本地执行配置，必须由 adapter
 * 在该组件之外渲染，不能进入 Proposal 草稿。
 */
export function StoryOptionsControl({ disabled = false, ...props }: StoryOptionsControlProps) {
  return <StoryOptionsPanel {...props} isGenerating={disabled} />;
}
