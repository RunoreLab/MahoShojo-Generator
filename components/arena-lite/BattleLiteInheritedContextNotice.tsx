'use client';

import Link from 'next/link';

import type { BattleLiteInheritedSummary } from './battle-lite-inherited-summary';

export function BattleLiteInheritedContextNotice(props: {
  summary: BattleLiteInheritedSummary;
}) {
  const { inheritedSettings, hiddenContext, hasHiddenContext } = props.summary;

  return (
    <div className="battle-lite-info-box rounded-2xl px-4 py-3 text-sm">
      <div className="battle-lite-strong-text font-medium">当前沿用完整版设置</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {inheritedSettings.map((item) => (
          <span key={item} className="battle-lite-info-pill rounded-full px-2.5 py-1 text-xs">
            {item}
          </span>
        ))}
      </div>

      <div className="battle-lite-subtle-text mt-3 text-xs">
        {hasHiddenContext ? hiddenContext.join('｜') : '当前未继承额外高级上下文'}
      </div>

      <Link href="/arena" className="battle-lite-link mt-3 inline-flex text-sm font-medium">
        前往完整版编辑
      </Link>
    </div>
  );
}
