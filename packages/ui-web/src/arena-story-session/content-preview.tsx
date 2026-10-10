'use client';

import { useState, type ReactNode } from 'react';

/** A parser/DOM display guard only; it does not limit generation, storage or export. */
export const BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS = 256 * 1024;

export type BattleStoryContentPreviewProps = {
  /** The original JavaScript string length; no copying or encoding of the body is needed. */
  characterCount: number;
  children: ReactNode;
  exportAction?: ReactNode;
};

/** Hosts key this component by chapter identity so opening A never implicitly opens B. */
export function BattleStoryContentPreview({ characterCount, children, exportAction }: BattleStoryContentPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  if (characterCount <= BATTLE_STORY_CONTENT_PREVIEW_CHARACTERS) return children;

  return (
    <div className="space-y-3" data-story-content-preview>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div>正文完整保留。为减少超长战报的解析与页面开销，默认收起。</div>
        <div className="mt-1">可展开全文，或直接导出；展开后可能需要较长时间。</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold"
          >
            {expanded ? '收起全文' : '展开全文'}
          </button>
          {exportAction}
        </div>
      </div>
      {expanded ? children : null}
    </div>
  );
}
