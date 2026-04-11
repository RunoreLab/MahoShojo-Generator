import type { ChallengeUnlockRecord } from '@/lib/challenge/types';

type ChallengeUnlockPanelProps = {
  unlocks: ChallengeUnlockRecord[];
};

const UNLOCK_GROUPS: Array<{
  unlockType: string;
  label: string;
}> = [
  { unlockType: 'enemy-log', label: '敌人记录' },
  { unlockType: 'event-log', label: '事件记录' },
  { unlockType: 'start-action-option', label: '起始动作候选' },
  { unlockType: 'start-persistent-item-option', label: '起始奇物候选' },
];

export function ChallengeUnlockPanel({ unlocks }: ChallengeUnlockPanelProps) {
  const recentUnlocks = [...unlocks].sort((left, right) => right.createdAt - left.createdAt).slice(0, 4);

  return (
    <section className="rounded-[28px] border border-amber-200/70 bg-white/88 p-6 shadow-[0_16px_48px_rgba(251,191,36,0.10)] backdrop-blur">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-600">本地解锁</p>
        <h3 className="mt-2 text-xl font-semibold text-slate-900">挑战档案</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">首版长期解锁仅保存在当前浏览器，会作为后续挑战的本地进度。</p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {UNLOCK_GROUPS.map((group) => {
          const count = unlocks.filter((item) => item.unlockType === group.unlockType).length;
          return (
            <article key={group.unlockType} className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-4">
              <p className="text-sm font-medium text-slate-900">{group.label}</p>
              <p className="mt-2 text-2xl font-semibold text-amber-700">{count}</p>
            </article>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-slate-900">最近解锁</h4>
          <span className="text-xs text-slate-500">共 {unlocks.length} 项</span>
        </div>

        <div className="mt-3 space-y-3">
          {recentUnlocks.length === 0 ? (
            <p className="text-sm text-slate-500">还没有本地解锁，先去完成几场挑战吧。</p>
          ) : null}

          {recentUnlocks.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{item.title}</p>
              <p className="mt-1 text-xs leading-6 text-slate-500">{item.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
