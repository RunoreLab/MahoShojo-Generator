import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import type { ChallengeEnemyDisplayState } from '@/lib/challenge/enemy-display';

type ChallengeEnemyCardSectionProps = {
  state: ChallengeEnemyDisplayState | null;
  onSaveImage?: (imageUrl: string) => void;
};

const MAGICAL_GIRL_GRADIENT = 'linear-gradient(135deg, #9775fa 0%, #b197fc 100%)';

export function ChallengeEnemyCardSection({
  state,
  onSaveImage,
}: ChallengeEnemyCardSectionProps) {
  if (!state || state.status === 'idle') return null;

  return (
    <section className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50/80 p-4 shadow-[0_10px_30px_rgba(148,163,184,0.10)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">敌方档案</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">敌方角色卡</h3>
        </div>
        {state.message ? (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
            {state.message}
          </span>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
          正在解析敌方角色卡...
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          {state.message || '敌方角色卡解析失败。'}
        </div>
      ) : null}

      {(state.status === 'resolved' || state.status === 'fallback') && state.card ? (
        <div className="overflow-hidden rounded-[24px]">
          {state.template === 'magical-girl' ? (
            <MagicalGirlCard
              magicalGirl={state.card as any}
              gradientStyle={MAGICAL_GIRL_GRADIENT}
              onSaveImage={onSaveImage}
            />
          ) : null}
          {state.template === 'canshou' ? (
            <CanshouCard canshou={state.card as any} onSaveImage={onSaveImage} />
          ) : null}
          {state.template === 'general' ? (
            <GeneralCharacterCard general={state.card as any} onSaveImage={onSaveImage} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
