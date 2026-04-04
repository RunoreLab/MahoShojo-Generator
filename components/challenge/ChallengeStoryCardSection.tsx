import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';

export type ChallengeStoryCardState = {
  markdown: string;
  reasoning: AIReasoningEnvelope | null;
  telemetry: Record<string, unknown> | null;
  finalSource: 'ai' | 'system-fallback' | 'system';
};

type ChallengeStoryCardSectionProps = {
  state: ChallengeStoryCardState;
  isResolving: boolean;
  onSaveImage?: (imageUrl: string) => void;
};

export function ChallengeStoryCardSection({
  state,
  isResolving,
  onSaveImage,
}: ChallengeStoryCardSectionProps) {
  const aiUsage = normalizeUsage(state.telemetry?.usage ?? null);
  const aiModel =
    typeof state.telemetry?.aiModel === 'string' && state.telemetry.aiModel.trim()
      ? state.telemetry.aiModel.trim()
      : null;

  return (
    <div className="mt-6">
      <StreamingBattleReportCard
        content={state.markdown}
        aiReasoning={state.reasoning}
        aiUsage={aiUsage}
        aiModel={aiModel}
        isStreaming={isResolving}
        onSaveImage={onSaveImage}
      />
    </div>
  );
}
