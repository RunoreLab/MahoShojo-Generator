'use client';

import SaveToCloudButton from '@/components/SaveToCloudButton';
import { NewsReport, type BattleReportIllustrationAsset } from '@/components/BattleReportCard';

import { useEffect, useMemo, useState } from 'react';
import { useBattleStore } from '../stores/useBattleStore';
import { useBattleEngine } from '../hooks/useBattleEngine';
import { getCombatantDisplayName } from '../utils/characterValidator';
import { toBattleReportMarkdown } from '../utils/battleReportMarkdown';
import { inferTemplate } from '@/lib/data-card-converter';
import { precheckBattleReportForRedo } from '@/lib/arena/redo-updates';
import { BattleStoreState, CombatantData, UpdatedCombatantData } from '../types';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { BattleIllustrationPanel } from './BattleIllustrationPanel';
import { BattleResultPresentation } from './BattleResultPresentation';
import { resolveBattleReportCardManualWidthPx } from '../utils/battleReportCardWidth';

interface BattleResultProps {
  onSaveImage: (imageUrl: string) => void;
}

export function BattleResult({ onSaveImage }: BattleResultProps) {
  const { handleRedoUpdates, handleApplyManualMetaUpdates, stopGeneration, isCooldown, remainingTime, isRedoingUpdates } = useBattleEngine();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const adjudicationResults = useBattleSelector((state) => state.adjudicationResults);
  const newsReport = useBattleSelector((state) => state.newsReport);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const streamingMarkdown = useBattleSelector((state) => state.streamingMarkdown);
  const streamReporterInfo = useBattleSelector((state) => state.streamReporterInfo);
  const streamUserGuidance = useBattleSelector((state) => state.streamUserGuidance);
  const streamCharacterGuidances = useBattleSelector((state) => state.streamCharacterGuidances);
  const streamAiUsage = useBattleSelector((state) => state.streamAiUsage);
  const streamAiModel = useBattleSelector((state) => state.streamAiModel);
  const streamNarrativeHistoryReadCount = useBattleSelector((state) => state.streamNarrativeHistoryReadCount);
  const streamReasoning = useBattleSelector((state) => state.streamReasoning);
  const streamUpdateMetaDebug = useBattleSelector((state) => state.streamUpdateMetaDebug);
  const streamSoftTimeoutWarning = useBattleSelector((state) => state.streamSoftTimeoutWarning);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const combatants = useBattleSelector((state) => state.combatants);
  const updatedCombatants = useBattleSelector((state) => state.updatedCombatants);
  const latestAiImpacts = useBattleSelector((state) => state.latestAiImpacts);
  const lastGenerationId = useBattleSelector((state) => state.lastGenerationId);
  const settings = useBattleSelector((state) => state.settings);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const scenario = useBattleSelector((state) => state.scenario);
  const [illustrationAsset, setIllustrationAsset] = useState<BattleReportIllustrationAsset | null>(null);
  const [manualMetaInput, setManualMetaInput] = useState('');
  const [manualMetaMessage, setManualMetaMessage] = useState<string | null>(null);
  const battleReportCardWidthPx = resolveBattleReportCardManualWidthPx(settings);

  const scenarioDisplayName = useMemo(() => {
    if (battleMode !== 'scenario') return undefined;
    const rawTitle = (scenario.content as any)?.title ?? (scenario.content as any)?.name;
    if (typeof rawTitle === 'string' && rawTitle.trim()) {
      return rawTitle.trim();
    }
    return scenario.fileName ?? undefined;
  }, [battleMode, scenario.content, scenario.fileName]);

  const hasBattleReport = generationMode === 'stream' ? Boolean(streamingMarkdown) : Boolean(newsReport);
  const shouldShowIllustrationPanel = hasBattleReport && !isGenerating;
  const illustrationPanelKey = `${generationMode}:${lastGenerationId ?? 'no-id'}:${
    generationMode === 'stream'
      ? (streamingMarkdown ?? '').slice(0, 80)
      : (newsReport?.headline ?? '')
  }`;
  const promptCombatants = useMemo(
    () => combatants.filter((item): item is CombatantData => 'data' in item),
    [combatants]
  );
  const canWriteUpdates = settings.writeArenaHistory || settings.writeCurrentState;
  const reportMarkdownForRedo =
    generationMode === 'stream'
      ? (streamingMarkdown ?? '').trim()
      : (newsReport ? toBattleReportMarkdown(newsReport as NewsReport) : '').trim();
  const redoPrecheck = precheckBattleReportForRedo(reportMarkdownForRedo, battleMode);
  const streamMetaDebugSummary = useMemo(() => {
    if (!streamUpdateMetaDebug) return null;
    const sourceLabel = streamUpdateMetaDebug.source === 'sse' ? 'SSE' : '注释解析';
    const okLabel = streamUpdateMetaDebug.parseOk ? '解析成功' : '解析失败';
    const rawLabel = streamUpdateMetaDebug.raw ? (streamUpdateMetaDebug.rawTruncated ? 'raw 已截断' : 'raw 可用') : 'raw 缺失';
    return `${sourceLabel}｜${okLabel}｜${rawLabel}`;
  }, [streamUpdateMetaDebug]);
  const streamMetaParsedJson = useMemo(() => {
    if (!streamUpdateMetaDebug?.meta) return '';
    try {
      return JSON.stringify(streamUpdateMetaDebug.meta, null, 2);
    } catch {
      return '';
    }
  }, [streamUpdateMetaDebug?.meta]);
  const manualMetaDefault = useMemo(() => {
    if (streamMetaParsedJson) return streamMetaParsedJson;
    if (typeof streamUpdateMetaDebug?.raw === 'string' && streamUpdateMetaDebug.raw.trim()) {
      return streamUpdateMetaDebug.raw;
    }
    return '';
  }, [streamMetaParsedJson, streamUpdateMetaDebug?.raw]);

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

  useEffect(() => {
    setIllustrationAsset(null);
  }, [lastGenerationId]);

  useEffect(() => {
    if (!hasBattleReport) {
      setIllustrationAsset(null);
    }
  }, [hasBattleReport]);

  useEffect(() => {
    setManualMetaInput(manualMetaDefault);
    setManualMetaMessage(null);
  }, [manualMetaDefault, lastGenerationId]);

  const handleResetManualMetaInput = () => {
    setManualMetaInput(manualMetaDefault);
    setManualMetaMessage(manualMetaDefault ? '已恢复为当前解析结果。' : '当前暂无可恢复的解析结果。');
  };

  const handleApplyManualMeta = async () => {
    const ok = await handleApplyManualMetaUpdates(manualMetaInput);
    if (ok) {
      setManualMetaMessage('手动修改已应用，角色更新完成。');
    } else {
      setManualMetaMessage('应用失败，请检查 JSON 与角色名是否完整匹配。');
    }
  };

  return (
    <>
      <BattleResultPresentation
        report={generationMode === 'stream'
          ? isGenerating || streamingMarkdown !== null
            ? {
                format: 'stream-markdown',
                content: streamingMarkdown ?? '',
                mode: battleMode,
                scenarioName: scenarioDisplayName,
                reporterInfo: streamReporterInfo,
                userGuidance: streamUserGuidance,
                characterGuidances: streamCharacterGuidances,
                aiUsage: streamAiUsage,
                aiModel: streamAiModel,
                narrativeHistoryReadCount: streamNarrativeHistoryReadCount,
                aiReasoning: streamReasoning,
                isStreaming: isGenerating,
                softTimeoutWarning: streamSoftTimeoutWarning,
                onStopGeneration: stopGeneration,
                illustrationAsset,
                cardWidthPx: battleReportCardWidthPx,
              }
            : null
          : newsReport
            ? {
                format: 'structured-report',
                report: newsReport as NewsReport,
                mode: battleMode,
                illustrationAsset,
                cardWidthPx: battleReportCardWidthPx,
              }
            : null}
        onSaveImage={onSaveImage}
        adjudicationResults={adjudicationResults}
      />

      {shouldShowIllustrationPanel && (
        <BattleIllustrationPanel
          key={illustrationPanelKey}
          headline={generationMode === 'stream' ? null : (newsReport?.headline ?? null)}
          reportBody={generationMode === 'stream' ? null : (newsReport?.article?.body ?? null)}
          reportMarkdown={generationMode === 'stream' ? (streamingMarkdown ?? null) : null}
          combatants={promptCombatants}
          aiImpacts={latestAiImpacts}
          onIllustrationAssetChange={setIllustrationAsset}
        />
      )}

      {hasBattleReport && canWriteUpdates && (
        <div className="card mt-6">
          <CollapsibleSection
            title="角色更新"
            description={`可下载/保存本次更新的角色设定（共 ${updatedCombatants.length} 个）`}
            defaultOpen
            storageKey="arena.section.updatedCombatants.open"
            variant="plain"
            titleClassName="text-lg font-bold text-gray-800"
            headerClassName="mb-3"
            headerRight={
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
            }
          >
            <div className="space-y-4">
              {generationMode === 'stream' && streamUpdateMetaDebug && (
                <CollapsibleSection
                  title="元数据诊断"
                  description={streamMetaDebugSummary ?? undefined}
                  defaultOpen={false}
                  storageKey="arena.section.streamUpdateMetaDebug.open"
                  variant="panel"
                >
                  <div className="text-sm text-gray-600 space-y-3">
                    {streamUpdateMetaDebug.error && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div className="font-medium text-amber-800">错误信息</div>
                        <div className="mt-1 whitespace-pre-wrap break-words">{streamUpdateMetaDebug.error}</div>
                      </div>
                    )}
                    {streamMetaParsedJson && (
                      <div>
                        <div className="font-medium text-gray-700">解析结果（parsed meta）</div>
                        <div className="mt-1">
                          <MarkdownBlock content={`\`\`\`json\n${streamMetaParsedJson}\n\`\`\``} variant="light" />
                        </div>
                      </div>
                    )}
                    {streamUpdateMetaDebug.raw && (
                      <div>
                        <div className="font-medium text-gray-700">
                          原始输出（raw meta）{streamUpdateMetaDebug.rawTruncated ? '（已截断）' : ''}
                        </div>
                        <div className="mt-1">
                          <MarkdownBlock content={`\`\`\`\n${streamUpdateMetaDebug.raw}\n\`\`\``} variant="light" />
                        </div>
                      </div>
                    )}
                    <div className="p-3 border border-gray-200 rounded-lg bg-white">
                      <div className="font-medium text-gray-700">手动修正并应用</div>
                      <div className="mt-1 text-xs text-gray-500">
                        支持粘贴 JSON 对象/数组或 MAHOSHOJO_ARENA_META 注释。应用后会直接更新当前角色数据。
                      </div>
                      <textarea
                        value={manualMetaInput}
                        onChange={(event) => {
                          setManualMetaInput(event.target.value);
                          setManualMetaMessage(null);
                        }}
                        spellCheck={false}
                        rows={12}
                        className="mt-2 w-full rounded-lg border border-gray-300 bg-slate-950 text-slate-100 p-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-400"
                        placeholder={'{"version":1,"impacts":[{"characterName":"角色名","impact":"变化","currentStateSummary":"状态"}]}'}
                      />
                      {manualMetaMessage && (
                        <div className="mt-2 text-xs text-gray-600">{manualMetaMessage}</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={handleResetManualMetaInput}
                          type="button"
                          disabled={isGenerating || isRedoingUpdates}
                          className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          恢复当前解析结果
                        </button>
                        <button
                          onClick={() => void handleApplyManualMeta()}
                          type="button"
                          disabled={isGenerating || isRedoingUpdates || !manualMetaInput.trim()}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isRedoingUpdates ? '应用中...' : '应用手动修改'}
                        </button>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>
              )}
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
                  <CollapsibleSection
                    key={name}
                    title={
                      <span className="font-semibold text-gray-700">
                        {name} <span className="text-xs text-gray-500">({typeDisplay})</span>
                      </span>
                    }
                    defaultOpen={false}
                    variant="panel"
                  >
                    <div className="text-sm text-gray-600">
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
                    <JsonSizeIndicator
                      data={character}
                      className="mt-2"
                      warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                    />
                  </CollapsibleSection>
                );
              })}
            </div>
          </CollapsibleSection>
        </div>
      )}
    </>
  );
}
