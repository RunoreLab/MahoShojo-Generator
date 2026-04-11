'use client';

import Link from 'next/link';

import type { BattleLiteInheritedSummary } from './battle-lite-inherited-summary';

export function BattleLiteInheritedContextNotice(props: {
  summary: BattleLiteInheritedSummary;
}) {
  const { inheritedSettings, hiddenContext, hasHiddenContext } = props.summary;

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/85 px-4 py-3 text-sm text-slate-700">
      <div className="font-medium text-slate-900">当前沿用完整版设置</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {inheritedSettings.map((item) => (
          <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700">
            {item}
          </span>
        ))}
      </div>

      <div className="mt-3 text-xs text-slate-600">
        {hasHiddenContext ? hiddenContext.join('｜') : '当前未继承额外高级上下文'}
      </div>

      <Link href="/arena" className="mt-3 inline-flex text-sm font-medium text-sky-700 hover:underline">
        前往完整版编辑
      </Link>
    </div>
  );
}
