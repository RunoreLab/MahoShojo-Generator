import type { PlayerSnapshotV1 } from '@/lib/challenge/types';

type ChallengeBootstrapPanelProps = {
  worldTitle: string;
  playerSnapshot: PlayerSnapshotV1;
  usedBootstrapReroll: boolean;
  onReroll: () => void;
  onAccept: () => void;
  onBack: () => void;
};

const readCombatProfileText = (playerSnapshot: PlayerSnapshotV1, key: string): string | null => {
  const combatProfile = playerSnapshot.combatProfile;
  if (!combatProfile || typeof combatProfile !== 'object' || Array.isArray(combatProfile)) return null;
  const value = (combatProfile as Record<string, unknown>)[key];
  if (Array.isArray(value)) {
    const joined = value.filter((item) => typeof item === 'string').join('、');
    return joined || null;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
};

const formatStrengthTier = (value: PlayerSnapshotV1['strengthTier']): string => {
  switch (value) {
    case 'boss':
      return 'Boss 级';
    case 'elite':
      return '精英级';
    default:
      return '标准级';
  }
};

export function ChallengeBootstrapPanel({
  worldTitle,
  playerSnapshot,
  usedBootstrapReroll,
  onReroll,
  onAccept,
  onBack,
}: ChallengeBootstrapPanelProps) {
  const specialties = readCombatProfileText(playerSnapshot, 'specialties');
  const powerLevel = readCombatProfileText(playerSnapshot, 'powerLevel');
  const promptSummary = playerSnapshot.promptSummary || '暂无更多补充。';

  return (
    <section className="rounded-[28px] border border-amber-200/70 bg-white/90 p-6 shadow-[0_18px_54px_rgba(251,191,36,0.14)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-500">Bootstrap</p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">竞技场快照确认</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {worldTitle} 会基于当前角色卡生成一份本轮挑战专用快照。接受后才会冻结地图与正式种子。
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          {formatStrengthTier(playerSnapshot.strengthTier)}
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">角色</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{playerSnapshot.displayName}</p>
          <p className="mt-1 text-sm text-slate-500">来源：{playerSnapshot.sourceType}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">战斗定位</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{powerLevel || formatStrengthTier(playerSnapshot.strengthTier)}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">关键属性倾向</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{playerSnapshot.tags.slice(0, 3).join('、') || '待补全'}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">关键动作倾向</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{specialties || '由 AI 根据文本设定补全'}</p>
        </article>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">初始风险 / 稳定性提示</p>
        <p className="mt-2 text-sm leading-7 text-slate-700">{promptSummary}</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onAccept}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          接受快照并开始挑战
        </button>
        <button
          type="button"
          onClick={onReroll}
          disabled={usedBootstrapReroll}
          className="rounded-full border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          一次免费重掷
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-slate-300 px-5 py-2.5 text-sm text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
        >
          返回大厅
        </button>
      </div>
    </section>
  );
}
