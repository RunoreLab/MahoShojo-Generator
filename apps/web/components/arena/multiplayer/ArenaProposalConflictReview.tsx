'use client';

import type { ArenaProposalChange } from '@mahoshojo/contracts/arena-room';
import type { ArenaProposalChangeAnalysis } from '@mahoshojo/multiplayer-core';
import { buttonClassName } from '@/components/shared/ui/Button';

const reviewValue = (input: unknown): string => {
  if (input && typeof input === 'object' && 'kind' in input) {
    if (input.kind === 'absent') return '目标不存在';
    if (input.kind === 'value' && 'value' in input) return reviewValue(input.value);
    if ((input.kind === 'ref' || input.kind === 'present') && 'ref' in input) return reviewValue(input.ref);
  }
  if (input === null || input === undefined || input === '') return '空值';
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2);
};
const proposedValue = (change: ArenaProposalChange): unknown => {
  if (change.type === 'setStoryLength') return { storyLength: change.value, customStoryLength: Object.prototype.hasOwnProperty.call(change, 'customStoryLength')
    ? change.customStoryLength ?? null : '保持当前自定义长度' };
  if ('value' in change) return change.value;
  if (change.type === 'assignTeam') return change.teamKey;
  if ('ref' in change) return change.ref;
  if (change.type === 'addTeam') return { key: change.teamKey, displayName: change.displayName };
  return { kind: 'absent' };
};
const blockedCopy = {
  'target-missing': '目标角色或队伍已不存在；请取消此项或重新编辑提案。',
  'reference-changed': '引用的数据卡已更新版本，需要重新选择数据卡。',
  'unsupported-change': '新增目标碰撞或列表重排冲突不能直接覆盖；请重新编辑该项。',
};

export function ArenaProposalConflictReview({ change, analysis, disabled, onAdopt, onKeep }: {
  readonly change: ArenaProposalChange;
  readonly analysis: ArenaProposalChangeAnalysis;
  readonly disabled: boolean;
  readonly onAdopt: () => void;
  readonly onKeep: () => void;
}) {
  const conflict = analysis.conflict;
  if (!conflict) return null;
  const adopted = analysis.outcome === 'overridden';
  return (
    <div className={`mt-2 min-w-0 rounded-lg p-2 text-sm ${analysis.overrideAllowed
      ? 'bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100'
      : 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-100'}`}
      data-conflict-code={conflict.code} data-conflict-target={conflict.target}>
      <p className="font-medium">{analysis.overrideAllowed
        ? adopted ? '已选择采用提案值；接受时将覆盖当前值。' : '该目标的当前值已与提案基准不一致，请决定采用哪一个值。'
        : blockedCopy[analysis.overrideBlockedReason ?? 'unsupported-change']}</p>
      <dl className="mt-2 space-y-2">
        {[
          ['提案基准', conflict.expectedBase], ['当前房间值', conflict.current], ['提案目标', proposedValue(change)],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="text-xs font-semibold">{String(label)}：</dt>
            <dd className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 dark:bg-gray-950/50">{reviewValue(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={buttonClassName()} disabled={disabled} onClick={onKeep}>
          保留当前值
        </button>
        {analysis.overrideAllowed ? (
          <button type="button" className={buttonClassName({ variant: 'primary' })}
            disabled={disabled} aria-pressed={adopted} onClick={onAdopt}>
            采用提案值
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs">选择后仍需点击「接受所选」才会更新房间；保留当前值将取消选择该项。</p>
    </div>
  );
}
