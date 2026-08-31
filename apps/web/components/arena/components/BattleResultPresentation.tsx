'use client';

import type { ReactNode } from 'react';

import BattleReportCard, {
  type BattleReportIllustrationAsset,
  type NewsReport,
} from '@/components/BattleReportCard';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';
import { resolveAdjudicationOutcomeTone } from '@/lib/adjudicator/presentation';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import type { AdjudicationResult } from '@/types/arena';

type ArenaBattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';

export type BattleResultStreamingPresentation = {
  readonly format: 'stream-markdown';
  readonly content: string;
  readonly isStreaming?: boolean;
  readonly mode?: ArenaBattleMode;
  readonly scenarioName?: string;
  readonly reporterInfo?: { readonly name: string; readonly publication: string } | null;
  readonly userGuidance?: string | null;
  readonly characterGuidances?: ReadonlyArray<{
    readonly characterName: string;
    readonly guidance: string;
  }> | null;
  readonly aiUsage?: {
    readonly promptTokens?: number | null;
    readonly reasoningTokens?: number | null;
    readonly completionTokens?: number | null;
    readonly totalTokens?: number | null;
    readonly cachedTokens?: number | null;
  } | null;
  readonly aiModel?: string | null;
  readonly narrativeHistoryReadCount?: number | null;
  readonly aiReasoning?: AIReasoningEnvelope | null;
  readonly softTimeoutWarning?: string | null;
  readonly onStopGeneration?: () => void;
  readonly illustrationAsset?: BattleReportIllustrationAsset | null;
  readonly cardWidthPx?: number | null;
};

export type BattleResultStructuredPresentation = {
  readonly format: 'structured-report';
  readonly report: NewsReport;
  readonly mode?: ArenaBattleMode;
  readonly illustrationAsset?: BattleReportIllustrationAsset | null;
  readonly cardWidthPx?: number | null;
};

export type BattleResultSafeCombatantUpdate = {
  readonly combatantKey: string;
  readonly displayName: string;
  readonly impact?: string | null;
  readonly currentStateSummary?: string | null;
};

export type BattleResultPresentationProps = {
  readonly report?: BattleResultStreamingPresentation | BattleResultStructuredPresentation | null;
  readonly onSaveImage?: (imageUrl: string) => void;
  readonly adjudicationResults?: ReadonlyArray<AdjudicationResult> | null;
  readonly combatantUpdates?: ReadonlyArray<BattleResultSafeCombatantUpdate> | null;
  readonly afterReport?: ReactNode;
};

const AdjudicationResults = ({
  results,
}: {
  readonly results: ReadonlyArray<AdjudicationResult>;
}) => (
  <div className="card mt-6">
    <CollapsibleSection
      title="🎲 随机判定结果"
      description={`共 ${results.length} 条`}
      defaultOpen={false}
      storageKey="arena.section.adjudicationResults.open"
      variant="plain"
      titleClassName="text-lg font-bold text-gray-800"
      headerClassName="mb-3"
    >
      <div className="space-y-2">
        {results.map((result, index) => {
          const outcomeTone = resolveAdjudicationOutcomeTone(result.outcome);
          return (
            <div
              key={`${result.depth}:${result.description}:${index}`}
              className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm"
              style={{ marginLeft: `${result.depth * 20}px` }}
            >
              {result.depth > 0 ? <span className="text-gray-400">↳ </span> : null}
              <span className="font-semibold text-gray-700">{result.description}</span>
              <p className="mt-1 text-gray-600">
                判定结果:{' '}
                <span
                  className={`font-bold ${
                    outcomeTone === 'success'
                      ? 'text-green-600'
                      : outcomeTone === 'failure'
                        ? 'text-red-600'
                        : 'text-blue-600'
                  }`}
                >
                  {result.outcome}
                </span>{' '}
                ({result.details})
              </p>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  </div>
);

const SafeCombatantUpdates = ({
  updates,
}: {
  readonly updates: ReadonlyArray<BattleResultSafeCombatantUpdate>;
}) => (
  <div className="card mt-6" data-arena-safe-combatant-updates="v1">
    <CollapsibleSection
      title="战后角色变化"
      description={`服务器公开的安全摘要（共 ${updates.length} 个）`}
      defaultOpen={false}
      storageKey="arena.section.safeCombatantUpdates.open"
      variant="plain"
      titleClassName="text-lg font-bold text-gray-800"
      headerClassName="mb-3"
    >
      <div className="space-y-3">
        {updates.map((update) => (
          <section
            key={update.combatantKey}
            aria-label={`${update.displayName}的战后变化`}
            className="rounded-lg border border-gray-200 bg-gray-50 p-3"
          >
            <h4 className="font-semibold text-gray-800">{update.displayName}</h4>
            {update.impact ? (
              <div className="mt-2 text-sm text-gray-600">
                <div className="font-medium text-gray-700">历战影响</div>
                <MarkdownBlock content={update.impact} variant="light" />
              </div>
            ) : null}
            {update.currentStateSummary ? (
              <div className="mt-2 text-sm text-gray-600">
                <div className="font-medium text-gray-700">当前状态</div>
                <MarkdownBlock content={update.currentStateSummary} variant="light" />
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </CollapsibleSection>
  </div>
);

export function BattleResultPresentation({
  report,
  onSaveImage,
  adjudicationResults,
  combatantUpdates,
  afterReport,
}: BattleResultPresentationProps) {
  return (
    <div className="contents" data-arena-battle-result-presentation="v1">
      {adjudicationResults?.length ? <AdjudicationResults results={adjudicationResults} /> : null}

      {report?.format === 'stream-markdown' ? (
        <div className="mt-6">
          <StreamingBattleReportCard
            content={report.content}
            onSaveImage={onSaveImage}
            mode={report.mode}
            scenarioName={report.scenarioName}
            reporterInfo={report.reporterInfo ? { ...report.reporterInfo } : null}
            userGuidance={report.userGuidance}
            characterGuidances={report.characterGuidances ? [...report.characterGuidances] : null}
            adjudicationResults={adjudicationResults ? [...adjudicationResults] : null}
            aiUsage={report.aiUsage}
            aiModel={report.aiModel}
            narrativeHistoryReadCount={report.narrativeHistoryReadCount}
            aiReasoning={report.aiReasoning}
            isStreaming={report.isStreaming}
            softTimeoutWarning={report.softTimeoutWarning}
            onStopGeneration={report.onStopGeneration}
            illustrationAsset={report.illustrationAsset}
            cardWidthPx={report.cardWidthPx}
          />
        </div>
      ) : report?.format === 'structured-report' ? (
        <BattleReportCard
          report={report.report}
          onSaveImage={onSaveImage}
          mode={report.mode}
          illustrationAsset={report.illustrationAsset}
          cardWidthPx={report.cardWidthPx}
        />
      ) : null}

      {combatantUpdates?.length ? <SafeCombatantUpdates updates={combatantUpdates} /> : null}
      {afterReport}
    </div>
  );
}
