import AiProviderSelector from '@/components/AiProviderSelector';
import { ChallengeEnemyCardSection } from '@/components/challenge/ChallengeEnemyCardSection';
import { ChallengeStoryCardSection, type ChallengeStoryCardState } from '@/components/challenge/ChallengeStoryCardSection';
import { formatStrengthTierLabel } from '@/lib/challenge/display-text';
import type { ChallengeEnemyDisplayState } from '@/lib/challenge/enemy-display';
import type { EncounterSnapshotV1 } from '@/lib/challenge/types';

export type ChallengeRecommendedAction = {
  id: string;
  label: string;
  hint: string;
};

type NodeResolutionPanelProps = {
  encounter: EncounterSnapshotV1;
  latestStoryText: string;
  isResolving: boolean;
  note: string;
  selectedOptionId: string;
  selectedRecommendedActionId: string;
  recommendedActions?: ChallengeRecommendedAction[];
  viewMode?: 'input' | 'result';
  enemyDisplayState?: ChallengeEnemyDisplayState | null;
  storyCardState?: ChallengeStoryCardState | null;
  onSaveImage?: (imageUrl: string) => void;
  onUserProviderConfigChange: Parameters<typeof AiProviderSelector>[0]['onConfigChange'];
  onRecommendedActionChange: (value: string) => void;
  onSelectOption: (value: string) => void;
  onNoteChange: (value: string) => void;
  onResolve: () => void;
  onBackToMap: () => void;
};

const defaultBattleRecommendedActions: ChallengeRecommendedAction[] = [
  { id: 'advance-pressure', label: '前压试探', hint: '抢节奏、逼对手交资源。' },
  { id: 'bait-counter', label: '诱导反制', hint: '留出窗口，等待敌方露出破绽。' },
  { id: 'focus-barrier', label: '稳守蓄势', hint: '先稳住阵脚，再寻找反击点。' },
];

const getNodeTitle = (encounter: EncounterSnapshotV1): string => {
  switch (encounter.kind) {
    case 'elite':
      return '精英节点';
    case 'event':
      return '事件节点';
    case 'rest':
      return '休整节点';
    case 'shop':
      return '商店节点';
    case 'boss':
      return '首领节点';
    default:
      return '战斗节点';
  }
};

export function NodeResolutionPanel({
  encounter,
  latestStoryText,
  isResolving,
  note,
  selectedOptionId,
  selectedRecommendedActionId,
  recommendedActions,
  viewMode = 'input',
  enemyDisplayState = null,
  storyCardState = null,
  onSaveImage,
  onUserProviderConfigChange,
  onRecommendedActionChange,
  onSelectOption,
  onNoteChange,
  onResolve,
  onBackToMap,
}: NodeResolutionPanelProps) {
  const actions = recommendedActions?.length ? recommendedActions : defaultBattleRecommendedActions;
  const isBattleNode = encounter.kind === 'battle' || encounter.kind === 'elite' || encounter.kind === 'boss';
  const usesAiResolution =
    isBattleNode || (encounter.kind === 'event' && encounter.inputMode !== 'choice-only');
  const showFreeIntent = encounter.inputMode === 'free-intent'
    || encounter.inputMode === 'choice-plus-note'
    || encounter.inputMode === 'recommended-action-plus-free-intent';
  const resolvedStoryCardState = storyCardState
    ?? (latestStoryText.trim()
      ? {
        markdown: latestStoryText,
        reasoning: null,
        telemetry: null,
        finalSource: 'ai',
      }
      : null);

  if (viewMode === 'result') {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">结算结果</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">{getNodeTitle(encounter)}</h2>
        {isBattleNode ? (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {`已整理${encounter.enemySnapshot?.displayName ?? '当前对手'}的角色卡，可继续查看并导出图片。`}
          </p>
        ) : null}
        {isBattleNode ? (
          <ChallengeEnemyCardSection state={enemyDisplayState} onSaveImage={onSaveImage} />
        ) : null}
        {resolvedStoryCardState ? (
          <ChallengeStoryCardSection
            state={resolvedStoryCardState}
            isResolving={false}
            onSaveImage={onSaveImage}
          />
        ) : (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-sm leading-7 text-slate-700">{latestStoryText || '本节点已结算。'}</p>
          </div>
        )}
        <div className="mt-5">
          <button
            type="button"
            onClick={onBackToMap}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            返回地图
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">当前节点</p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900">{getNodeTitle(encounter)}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {isBattleNode
              ? `已整理${encounter.enemySnapshot?.displayName ?? '当前对手'}的角色卡，可直接查看并导出图片。`
              : encounter.enemySnapshot
                ? `对手：${encounter.enemySnapshot.displayName} · ${encounter.enemySnapshot.promptSummary}`
                : '这是一个纯本地系统节点。'}
          </p>
        </div>
        {encounter.enemySnapshot ? (
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
            危险等级：{formatStrengthTierLabel(encounter.enemySnapshot.strengthTier)}
          </span>
        ) : null}
      </div>

      {isBattleNode ? (
        <ChallengeEnemyCardSection state={enemyDisplayState} onSaveImage={onSaveImage} />
      ) : null}

      {isBattleNode ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <h3 className="text-sm font-medium text-slate-900">推荐动作</h3>
            <div className="mt-3 space-y-3">
              {actions.map((action) => (
                <label key={action.id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-transparent bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-rose-200">
                  <input
                    type="radio"
                    name="challenge-recommended-action"
                    checked={selectedRecommendedActionId === action.id}
                    onChange={() => onRecommendedActionChange(action.id)}
                    className="mt-1 h-4 w-4 border-slate-300 text-rose-500 focus:ring-rose-500"
                  />
                  <span>
                    <span className="block font-medium text-slate-900">{action.label}</span>
                    <span className="mt-1 block text-slate-500">{action.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <h3 className="text-sm font-medium text-slate-900">自由意图</h3>
            {showFreeIntent ? (
              <textarea
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                className="mt-3 min-h-[180px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-rose-300"
                placeholder="输入你希望角色执行的具体行动、准备、话术或临场判断。"
              />
            ) : (
              <p className="mt-3 text-sm text-slate-500">当前节点不需要额外输入。</p>
            )}
          </article>
        </div>
      ) : null}

      {encounter.kind === 'event' || encounter.kind === 'rest' ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <h3 className="text-sm font-medium text-slate-900">可选方案</h3>
          <div className="mt-3 space-y-3">
            {encounter.eventOptions.map((option) => (
              <label key={option.optionId} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-transparent bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-emerald-200">
                <input
                  type="radio"
                  name="challenge-event-option"
                  checked={selectedOptionId === option.optionId}
                  onChange={() => onSelectOption(option.optionId)}
                  disabled={option.disabled}
                  className="mt-1 h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-500"
                />
                <span>
                  <span className="block font-medium text-slate-900">{option.label}</span>
                  <span className="mt-1 block text-slate-500">
                    {option.notePolicy === 'none' ? '纯系统结算' : '可附加文本意图'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {encounter.kind === 'shop' ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <h3 className="text-sm font-medium text-slate-900">本轮货架</h3>
          <div className="mt-3 space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-transparent bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-sky-200">
              <input
                type="radio"
                name="challenge-shop-option"
                checked={selectedOptionId === ''}
                onChange={() => onSelectOption('')}
                className="mt-1 h-4 w-4 border-slate-300 text-sky-500 focus:ring-sky-500"
              />
              <span>
                <span className="block font-medium text-slate-900">本次不购买</span>
                <span className="mt-1 block text-slate-500">保留晶尘，继续推进路线。</span>
              </span>
            </label>
            {encounter.shopOffers.map((offer) => (
              <label key={offer.offerId} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-transparent bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-sky-200">
                <input
                  type="radio"
                  name="challenge-shop-option"
                  checked={selectedOptionId === offer.offerId}
                  onChange={() => onSelectOption(offer.offerId)}
                  disabled={offer.disabled}
                  className="mt-1 h-4 w-4 border-slate-300 text-sky-500 focus:ring-sky-500"
                />
                <span>
                  <span className="block font-medium text-slate-900">{offer.reward.label}</span>
                  <span className="mt-1 block text-slate-500">价格 {offer.price} 晶尘</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {usesAiResolution ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <h3 className="text-sm font-medium text-slate-900">AI 裁定模型</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            当前节点会调用 AI 生成裁定文本。你可以在这里切换模型或提供商，设置会与
            {' '}
            <span className="font-medium text-slate-800">/arena</span>
            {' '}
            共用。
          </p>
          <div className="mt-4">
            <AiProviderSelector onConfigChange={onUserProviderConfigChange} />
          </div>
        </div>
      ) : null}

      {resolvedStoryCardState ? (
        <ChallengeStoryCardSection
          state={resolvedStoryCardState}
          isResolving={isResolving}
          onSaveImage={onSaveImage}
        />
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onResolve}
          disabled={isResolving}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isResolving ? '结算中...' : '提交结算'}
        </button>
      </div>
    </section>
  );
}
