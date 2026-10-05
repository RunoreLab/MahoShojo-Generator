'use client';

import type { ReactNode } from 'react';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

export type CombatantUpdatePresentationItem = {
  readonly key: string;
  readonly displayName: string;
  readonly typeLabel?: string | null;
  readonly impact?: string | null;
  readonly currentStateSummary?: string | null;
};

export type CombatantUpdatesPresentationProps = {
  readonly title?: string;
  readonly description?: string;
  readonly items: readonly CombatantUpdatePresentationItem[];
  readonly defaultOpen?: boolean;
  readonly itemDefaultOpen?: boolean;
  readonly storageKey?: string;
  readonly emptyMessage?: string | null;
  readonly headerRight?: ReactNode;
  readonly renderBeforeItems?: ReactNode;
  readonly renderActions?: (
    item: CombatantUpdatePresentationItem,
    index: number,
  ) => ReactNode;
  readonly renderFooter?: ReactNode;
};

const hasPresentationContent = (item: CombatantUpdatePresentationItem): boolean => Boolean(
  item.impact?.trim() || item.currentStateSummary?.trim(),
);

export function CombatantUpdatesPresentation({
  title = '角色更新',
  description,
  items,
  defaultOpen = true,
  itemDefaultOpen = true,
  storageKey,
  emptyMessage = '本场没有可公开的角色变化。',
  headerRight,
  renderBeforeItems,
  renderActions,
  renderFooter,
}: CombatantUpdatesPresentationProps) {
  const visibleItems = items.flatMap((item) => {
    if (!hasPresentationContent(item)) return [];
    return [{
      ...item,
      impact: item.impact?.trim() || null,
      currentStateSummary: item.currentStateSummary?.trim() || null,
      typeLabel: item.typeLabel?.trim() || null,
    }];
  });

  return (
    <div className="card mt-6" data-arena-combatant-updates="v1">
      <CollapsibleSection
        title={title}
        description={description}
        defaultOpen={defaultOpen}
        storageKey={storageKey}
        variant="plain"
        titleClassName="text-lg font-bold text-gray-800"
        headerClassName="mb-3"
        headerRight={headerRight}
      >
        <div className="space-y-4">
          {renderBeforeItems}
          {visibleItems.length === 0 && emptyMessage ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              {emptyMessage}
            </div>
          ) : null}
          {visibleItems.map((item, index) => (
            <section key={item.key} aria-label={`${item.displayName}的战后变化`}>
              <CollapsibleSection
                title={(
                  <span className="font-semibold text-gray-700">
                    {item.displayName}
                    {item.typeLabel ? (
                      <span className="text-xs text-gray-500"> ({item.typeLabel})</span>
                    ) : null}
                  </span>
                )}
                defaultOpen={itemDefaultOpen}
                variant="panel"
              >
                {item.impact ? (
                  <div className="text-sm text-gray-600">
                    <div className="font-medium text-gray-700">历战记录</div>
                    <div className="mt-1">
                      <MarkdownBlock content={item.impact} variant="light" />
                    </div>
                  </div>
                ) : null}
                {item.currentStateSummary ? (
                  <div className="mt-3 text-sm text-gray-600">
                    <div className="font-medium text-gray-700">当前状态</div>
                    <div className="mt-1">
                      <MarkdownBlock content={item.currentStateSummary} variant="light" />
                    </div>
                  </div>
                ) : null}
                {renderActions?.(item, index)}
              </CollapsibleSection>
            </section>
          ))}
          {renderFooter}
        </div>
      </CollapsibleSection>
    </div>
  );
}
