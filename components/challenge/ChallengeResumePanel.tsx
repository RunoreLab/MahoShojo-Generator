import type { ChallengeRunRecord } from '@/lib/challenge/types';

type ChallengeResumePanelProps = {
  worldTitle: string;
  runs: ChallengeRunRecord[];
  isLoading: boolean;
  onResume: (runId: string) => void;
  onDelete: (runId: string) => void;
};

const formatRunStatus = (status: ChallengeRunRecord['status']): string => {
  switch (status) {
    case 'bootstrapping':
      return '快照确认中';
    case 'in_progress':
      return '进行中';
    case 'completed':
      return '已通关';
    case 'failed':
      return '已失败';
    case 'abandoned':
      return '已放弃';
    default:
      return status;
  }
};

export function ChallengeResumePanel({
  worldTitle,
  runs,
  isLoading,
  onResume,
  onDelete,
}: ChallengeResumePanelProps) {
  const resumableRuns = runs.filter((run) => run.status === 'in_progress');

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/80 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">继续挑战</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">最近挑战</h3>
        </div>
        {isLoading ? <span className="text-xs text-slate-400">读取中</span> : null}
      </div>

      <div className="mt-5 space-y-3">
        {runs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
            还没有本地挑战存档。
          </div>
        ) : null}

        {runs.map((run) => {
          const canResume = run.status === 'in_progress';

          return (
            <article key={run.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {run.worldPresetId === 'arena' ? worldTitle : run.worldPresetId}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatRunStatus(run.status)} · 已完成节点 {run.visitedNodeCount}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">{run.id.slice(0, 8)}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {canResume ? (
                  <button
                    type="button"
                    onClick={() => onResume(run.id)}
                    className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700"
                  >
                    继续挑战
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDelete(run.id)}
                  className="rounded-full border border-slate-300 px-4 py-2 text-xs text-slate-600 transition hover:border-red-300 hover:text-red-600"
                >
                  删除本地挑战
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
        当前可继续的挑战数：{resumableRuns.length}。首版存档仅保存在当前浏览器。
      </div>
      <p className="mt-3 text-xs leading-6 text-slate-500">
        删除本地挑战只会清理该次挑战的存档与过程记录，不会清除已经写入本地的长期解锁档案。
      </p>
    </section>
  );
}
