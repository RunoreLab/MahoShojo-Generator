'use client';
import { CombatantUpdatesPresentation as SharedPresentation, type CombatantUpdatesPresentationProps as SharedProps } from '@mahoshojo/ui-web/arena-report';
import { MarkdownBlock } from '@/components/MarkdownBlock';
export type { CombatantUpdatePresentationItem } from '@mahoshojo/ui-web/arena-report';
export type CombatantUpdatesPresentationProps = Omit<SharedProps, 'renderMarkdown'>;
export function CombatantUpdatesPresentation(props: CombatantUpdatesPresentationProps) {
  return <SharedPresentation {...props} renderMarkdown={(content) => <MarkdownBlock content={content} variant="light" />} />;
}
