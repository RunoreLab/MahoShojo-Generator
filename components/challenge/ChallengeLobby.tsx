import { ChallengeResumePanel } from '@/components/challenge/ChallengeResumePanel';
import { ChallengeUnlockPanel } from '@/components/challenge/ChallengeUnlockPanel';
import type { ChallengeRunRecord, ChallengeUnlockRecord } from '@/lib/challenge/types';

type ChallengeLobbyProps = {
  worldTitle: string;
  recentRuns: ChallengeRunRecord[];
  unlocks: ChallengeUnlockRecord[];
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

export function ChallengeLobby({
  worldTitle,
  recentRuns,
  unlocks,
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

      <aside className="space-y-5">
        <ChallengeResumePanel
          worldTitle={worldTitle}
          runs={recentRuns}
          isLoading={isLoadingRecentRuns}
          onResume={onResumeRun}
          onDelete={onDeleteRun}
        />
        <ChallengeUnlockPanel unlocks={unlocks} />
      </aside>
    </div>
  );
}
