import type { ChallengeUnlockRecord, RunStateV1 } from '@/lib/challenge/types';

type ChallengeSummaryPageProps = {
  worldTitle: string;
  runState: RunStateV1;
  summaryText: string;
  newUnlocks?: ChallengeUnlockRecord[];
  onBackToLobby: () => void;
};

const getResultTitle = (status: RunStateV1['status']): string => {
  switch (status) {
    case 'completed':
      return '挑战成功';
    case 'failed':
      return '挑战失败';
    default:
      return '挑战已结束';
  }
};

export function ChallengeSummaryPage({
  worldTitle,
  runState,
  summaryText,
  newUnlocks = [],
  onBackToLobby,
}: ChallengeSummaryPageProps) {
  return (
    <section className="rounded-[28px] border border-indigo-200/70 bg-white/90 p-6 shadow-[0_18px_54px_rgba(99,102,241,0.12)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-500">结算摘要</p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">本轮挑战结算</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {worldTitle} · {getResultTitle(runState.status)}
          </p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          {getResultTitle(runState.status)}
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">已完成节点</p>
          <p className="mt-2 text-sm text-slate-500">{`已完成节点 ${runState.visitedNodeCount}`}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{runState.visitedNodeCount}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">剩余生命</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{runState.worldState?.tracks.hp.current ?? '暂无'}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">剩余光辉</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{runState.worldState?.tracks.radiance.current ?? '暂无'}</p>
        </article>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm leading-7 text-slate-700">{summaryText}</p>
      </div>

      {newUnlocks.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-900">本轮新解锁</h3>
            <span className="text-xs text-amber-700">{newUnlocks.length} 项</span>
          </div>
          <div className="mt-3 space-y-3">
            {newUnlocks.map((item) => (
              <article key={item.id} className="rounded-2xl border border-amber-100 bg-white/80 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                <p className="mt-1 text-xs leading-6 text-slate-600">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <button
          type="button"
          onClick={onBackToLobby}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          返回大厅
        </button>
      </div>
    </section>
  );
}
