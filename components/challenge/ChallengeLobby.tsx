import type { ChallengeRunRecord } from '@/lib/challenge/types';

type ChallengeLobbyProps = {
  worldTitle: string;
  recentRuns: ChallengeRunRecord[];
  isLoadingRecentRuns: boolean;
  cardJsonText: string;
  inputError: string | null;
  isSubmitting: boolean;
  onCardJsonChange: (value: string) => void;
  onLoadDemoCard: () => void;
  onPrepareChallenge: () => void;
  onResumeRun: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
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

export function ChallengeLobby({
  worldTitle,
  recentRuns,
  isLoadingRecentRuns,
  cardJsonText,
  inputError,
  isSubmitting,
  onCardJsonChange,
  onLoadDemoCard,
  onPrepareChallenge,
  onResumeRun,
  onDeleteRun,
}: ChallengeLobbyProps) {
  const resumableRuns = recentRuns.filter((run) => run.status === 'in_progress');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <section className="rounded-[28px] border border-rose-200/70 bg-white/85 p-6 shadow-[0_16px_48px_rgba(244,114,182,0.10)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">世界选择</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{worldTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              首版先专注竞技场世界。你可以直接载入试玩示例，也可以粘贴任意角色卡 JSON，让系统补出一份挑战快照。
            </p>
          </div>
          <button
            type="button"
            onClick={onLoadDemoCard}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700 transition hover:border-rose-300 hover:text-rose-600"
          >
            载入试玩示例
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <label className="block text-sm font-medium text-slate-800" htmlFor="challenge-card-json">
            角色卡 JSON
          </label>
          <textarea
            id="challenge-card-json"
            value={cardJsonText}
            onChange={(event) => onCardJsonChange(event.target.value)}
            className="min-h-[320px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-6 text-slate-700 outline-none transition focus:border-rose-300 focus:bg-white"
            placeholder="粘贴角色卡 JSON，或先载入试玩示例。"
          />
          {inputError ? <p className="text-sm text-red-600">{inputError}</p> : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPrepareChallenge}
            disabled={isSubmitting}
            className="rounded-full bg-rose-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            生成竞技场快照
          </button>
          <p className="text-sm text-slate-500">进入 bootstrap 后可进行一次免费重掷，再正式开始本轮挑战。</p>
        </div>
      </section>

      <aside className="rounded-[28px] border border-slate-200 bg-white/80 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">继续挑战</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-900">本地存档</h3>
          </div>
          {isLoadingRecentRuns ? <span className="text-xs text-slate-400">读取中</span> : null}
        </div>

        <div className="mt-5 space-y-3">
          {recentRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
              还没有本地挑战存档。
            </div>
          ) : null}

          {recentRuns.map((run) => {
            const canResume = run.status === 'in_progress';
            return (
              <article key={run.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{run.worldPresetId === 'arena' ? worldTitle : run.worldPresetId}</p>
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
                      onClick={() => onResumeRun(run.id)}
                      className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700"
                    >
                      继续挑战
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDeleteRun(run.id)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs text-slate-600 transition hover:border-red-300 hover:text-red-600"
                  >
                    删除本地记录
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
          当前可继续的挑战数：{resumableRuns.length}。首版存档仅保存在当前浏览器。
        </div>
      </aside>
    </div>
  );
}
