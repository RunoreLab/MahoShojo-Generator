'use client';

import SaveToCloudButton from '@/components/SaveToCloudButton';
import BattleReportCard, { NewsReport } from '@/components/BattleReportCard';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleEngine } from '../hooks/useBattleEngine';
import { getCombatantDisplayName } from '../utils/characterValidator';
import { toBattleReportMarkdown } from '../utils/battleReportMarkdown';
import { inferTemplate } from '@/lib/data-card-converter';
import { precheckBattleReportForRedo } from '@/lib/arena/redo-updates';
import { AdjudicationResult } from '@/types/arena';
import { BattleStoreState, UpdatedCombatantData } from '../types';
import { MarkdownBlock } from '@/components/MarkdownBlock';

interface BattleResultProps {
  onSaveImage: (imageUrl: string) => void;
}

export function BattleResult({ onSaveImage }: BattleResultProps) {
  const { handleRedoUpdates, isCooldown, remainingTime, isRedoingUpdates } = useBattleEngine();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const adjudicationResults = useBattleSelector((state) => state.adjudicationResults);
  const newsReport = useBattleSelector((state) => state.newsReport);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const streamingMarkdown = useBattleSelector((state) => state.streamingMarkdown);
  const streamReporterInfo = useBattleSelector((state) => state.streamReporterInfo);
  const streamUserGuidance = useBattleSelector((state) => state.streamUserGuidance);
  const streamAiUsage = useBattleSelector((state) => state.streamAiUsage);
  const streamNarrativeHistoryReadCount = useBattleSelector((state) => state.streamNarrativeHistoryReadCount);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const updatedCombatants = useBattleSelector((state) => state.updatedCombatants);
  const settings = useBattleSelector((state) => state.settings);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const scenario = useBattleSelector((state) => state.scenario);

  const hasBattleReport = generationMode === 'stream' ? Boolean(streamingMarkdown) : Boolean(newsReport);
  const canWriteUpdates = settings.writeArenaHistory || settings.writeCurrentState;
  const reportMarkdownForRedo =
    generationMode === 'stream'
      ? (streamingMarkdown ?? '').trim()
      : (newsReport ? toBattleReportMarkdown(newsReport as NewsReport) : '').trim();
  const redoPrecheck = precheckBattleReportForRedo(reportMarkdownForRedo, battleMode);

  const downloadUpdatedJson = (characterData: any) => {
    const name = characterData.codename || characterData.name;
    const jsonData = JSON.stringify(characterData, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `角色设定_${name}_更新.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {adjudicationResults && (
        <div className="card mt-6">
          <h3 className="text-lg font-bold text-gray-800 mb-3">🎲 随机判定结果</h3>
          <div className="space-y-2">
            {adjudicationResults.map((result: AdjudicationResult, index: number) => (
              <div
                key={index}
                className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                style={{ marginLeft: `${result.depth * 20}px` }}
              >
                {result.depth > 0 && <span className="text-gray-400">↳ </span>}
                <span className="font-semibold text-gray-700">{result.description}</span>
                <p className="text-gray-600 mt-1">
                  判定结果:{' '}
                  <span
                    className={`font-bold ${
                      result.outcome === '成功' || result.outcome === '大成功'
                        ? 'text-green-600'
                        : result.outcome === '失败' || result.outcome === '大失败'
                          ? 'text-red-600'
                          : 'text-blue-600'
                    }`}
                  >
                    {result.outcome}
                  </span>{' '}
                  ({result.details})
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {generationMode === 'stream' ? (
        isGenerating || streamingMarkdown !== null ? (
          <div className="mt-6">
            <StreamingBattleReportCard
              content={streamingMarkdown ?? ''}
              onSaveImage={onSaveImage}
              mode={battleMode}
              scenarioName={battleMode === 'scenario' ? scenario.fileName ?? undefined : undefined}
              reporterInfo={streamReporterInfo}
              userGuidance={streamUserGuidance}
              adjudicationResults={adjudicationResults}
              aiUsage={streamAiUsage}
              narrativeHistoryReadCount={streamNarrativeHistoryReadCount}
              isStreaming={isGenerating}
            />
          </div>
        ) : null
      ) : (
        newsReport && <BattleReportCard report={newsReport as NewsReport} onSaveImage={onSaveImage} mode={battleMode} />
      )}

      {hasBattleReport && canWriteUpdates && (
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h3 className="text-lg font-bold text-gray-800">角色更新</h3>
            <button
              onClick={() => handleRedoUpdates()}
              disabled={isGenerating || isRedoingUpdates || isCooldown || !redoPrecheck.ok}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
              title={
                isCooldown
                  ? `冷却中，请等待 ${remainingTime} 秒`
                  : !redoPrecheck.ok
                    ? redoPrecheck.error
                    : '基于战报重做角色更新'
              }
            >
              {isCooldown ? `冷却中 ${remainingTime}s` : isRedoingUpdates ? '重做中...' : '重做角色更新'}
            </button>
          </div>
          <div className="space-y-4">
            {updatedCombatants.length === 0 && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                本次尚未产生可展示的角色更新。你仍可点击“重做角色更新”，让 AI 基于战报生成（或修正）历战记录/当前状态摘要。
              </div>
            )}
            {updatedCombatants.map((character: UpdatedCombatantData) => {
              const entries = character.arena_history?.entries;
              const latestEntry = Array.isArray(entries) && entries.length > 0 ? entries[entries.length - 1] : null;
              const stateSummary = character.current_state?.summary?.trim();
              const name = getCombatantDisplayName(character);
              const template = inferTemplate(character);
              const typeDisplay =
                template === 'magical-girl' ? '魔法少女' : template === 'canshou' ? '残兽' : '通用角色';

              if (!latestEntry && !stateSummary) return null;

              return (
                <div key={name} className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-gray-700">
                        {name} <span className="text-xs text-gray-500">({typeDisplay})</span>
                      </p>
                      <div className="text-sm text-gray-600 mt-2">
                        <div className="font-medium text-gray-700">历战记录</div>
                        <div className="mt-1">
                          <MarkdownBlock
                            content={latestEntry ? latestEntry.impact : '已跳过写入，改为仅更新其它字段。'}
                            variant="light"
                          />
                        </div>
                      </div>
                      {stateSummary && (
                        <div className="text-sm text-gray-600 mt-3">
                          <div className="font-medium text-gray-700">当前状态</div>
                          <div className="mt-1">
                            <MarkdownBlock content={stateSummary} variant="light" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 justify-end">
                    <button
                      onClick={() => downloadUpdatedJson(character)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors shrink-0"
                    >
                      下载更新设定
                    </button>
                    <SaveToCloudButton
                      data={character}
                      buttonText="保存到云端"
                      className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors shrink-0"
                      style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
