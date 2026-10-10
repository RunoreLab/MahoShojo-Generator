'use client';
import type { ReactNode } from 'react';
import { CollapsibleSection } from '../creator';

export type AdvancedArenaHeaderViewProps = Readonly<{
  logo: ReactNode;
  description: ReactNode;
  guideChildren?: ReactNode;
  guideTitle?: ReactNode;
  guideDescription?: ReactNode;
  guideDefaultOpen?: boolean;
  /** Omit when the host owns disclosure state through guideOpen/onGuideOpenChange. */
  guideStorageKey?: string;
  guideOpen?: boolean;
  onGuideOpenChange?: (open: boolean) => void;
}>;

/** Actual full Arena hero and guide chrome. Host ports retain media, copy and navigation ownership. */
export function AdvancedArenaHeaderView({ logo, description, guideChildren, guideTitle = '📰 使用须知',
  guideDescription = '熟悉流程后可收起，减少滚动', guideDefaultOpen = true, guideStorageKey,
  guideOpen, onGuideOpenChange }: AdvancedArenaHeaderViewProps) {
  return <>
    <div className="text-center mb-4">
      {logo}
      <p className="subtitle" style={{ marginBottom: '1rem', marginTop: '1rem' }}>{description}</p>
    </div>
    {guideChildren != null && <CollapsibleSection
      title={guideTitle} description={guideDescription} defaultOpen={guideDefaultOpen}
      storageKey={guideStorageKey} open={guideOpen} onOpenChange={onGuideOpenChange}
      className="mb-6" contentClassName="text-sm"
    >
      {guideChildren}
    </CollapsibleSection>}
  </>;
}
