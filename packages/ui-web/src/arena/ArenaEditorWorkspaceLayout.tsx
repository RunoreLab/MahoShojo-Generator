'use client';
import type { ReactNode } from 'react';
import { CollapsibleSection } from '../creator';

export type ArenaEditorWorkspaceSection = {
  readonly kind: string;
  readonly title: ReactNode;
  readonly column: 'left' | 'right';
  readonly storageKey?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly content: ReactNode;
  readonly description: ReactNode;
  readonly defaultOpen?: boolean;
  readonly autoOpen?: boolean;
  readonly disabled?: boolean;
  readonly keepMounted?: boolean;
  readonly collapsible?: boolean;
};

const ArenaEditorSection = ({
  section,
  globallyDisabled,
}: {
  readonly section: ArenaEditorWorkspaceSection;
  readonly globallyDisabled: boolean;
}) => {
  return (
    <CollapsibleSection
      title={section.title}
      description={section.description}
      open={section.open}
      onOpenChange={section.onOpenChange}
      defaultOpen={section.defaultOpen}
      autoOpen={section.autoOpen}
      disabled={section.disabled ?? globallyDisabled}
      keepMounted={section.keepMounted}
      collapsible={section.collapsible}
      storageKey={section.storageKey}
    >
      {section.content}
    </CollapsibleSection>
  );
};

export function ArenaEditorWorkspaceLayout({
  sections,
  disabled = false,
}: {
  readonly sections: readonly ArenaEditorWorkspaceSection[];
  readonly disabled?: boolean;
}) {
  const left = sections.filter((section) => section.column === 'left');
  const right = sections.filter((section) => section.column === 'right');
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] xl:items-start">
      <div className="min-w-0 space-y-4">
        {left.map((section) => (
          <ArenaEditorSection key={section.kind} section={section} globallyDisabled={disabled} />
        ))}
      </div>
      <div className="min-w-0 space-y-4">
        {right.map((section) => (
          <ArenaEditorSection key={section.kind} section={section} globallyDisabled={disabled} />
        ))}
      </div>
    </div>
  );
}
