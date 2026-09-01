'use client';

import SaveToCloudButton from '@/components/SaveToCloudButton';
import { NewsReport, type BattleReportIllustrationAsset } from '@/components/BattleReportCard';

import { useEffect, useMemo, useState } from 'react';
import { useBattleStore } from '../stores/useBattleStore';
import { useBattleEngine } from '../hooks/useBattleEngine';
import { useCombatantRepair } from '../hooks/useCombatantRepair';
import { getCombatantDisplayName } from '../utils/characterValidator';
import { inferTemplate } from '@/lib/data-card-converter';
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
  const { handleRetryUpdates, stopGeneration, isRedoingUpdates } = useBattleEngine();
  const combatantRepair = useCombatantRepair();
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
  const shouldShowCombatantUpdates =
    canWriteUpdates || Boolean(lastGenerationId) || updatedCombatants.length > 0;
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

      {hasBattleReport && shouldShowCombatantUpdates && (
        <div className="card mt-6">
          <CollapsibleSection
            title="角色更新"
            description={`可下载/保存本次更新的角色设定（共 ${updatedCombatants.length} 个）`}
            defaultOpen
            storageKey="arena.section.updatedCombatants.open"
            variant="plain"
            titleClassName="text-lg font-bold text-gray-800"
            headerClassName="mb-3"
            headerRight={!combatantRepair.isInRoom ? (
              <button
                onClick={() => handleRetryUpdates()}
                disabled={
                  isGenerating
                  || isRedoingUpdates
                  || combatantRepair.isCombatantMutationPending
                  || !lastGenerationId
                  || combatantRepair.isRepairAppliedForGeneration
                }
                className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
                title={combatantRepair.isRepairAppliedForGeneration
                  ? '当前 roster 已应用自定义修复；需要生成新战报后才能再次权威重试'
                  : lastGenerationId
                    ? '重试应用本次服务器已生成的角色更新'
                    : '本次战报缺少 generationId，无法安全重试'}
              >
                {isRedoingUpdates ? '重试中...' : '重试角色更新'}
              </button>
            ) : undefined}
          >
            <div className="space-y-4">
              {combatantRepair.hasRepairContext && !combatantRepair.isInRoom && (
                <CollapsibleSection
                  title="自定义修复本次角色变化"
                  description="AI 只生成可编辑草稿；应用后会得到 unsigned、non-canonical 的当前会话副本"
                  defaultOpen={false}
                  storageKey="arena.section.combatantRepair.open"
                  variant="panel"
                >
                  <div className="space-y-3 text-sm text-gray-700">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                      修复原生角色或 preset/DataCard 时，会创建非原生可编辑版本；服务器不会重新签名，源角色也不会被自动覆盖。
                    </div>

                    {combatantRepair.isRepairAppliedForGeneration && (
                      <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-purple-800">
                        当前 roster 已应用本次自定义修复。同 generation 的服务器权威重试已禁用；生成新战报后会恢复。
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => combatantRepair.generateAiRepairDraft()}
                        disabled={
                          isGenerating
                          || combatantRepair.isGeneratingDraft
                          || combatantRepair.isApplyingRepair
                          || combatantRepair.isCooldown
                          || !combatantRepair.canGenerateAiDraft
                        }
                        className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {combatantRepair.isGeneratingDraft
                          ? 'AI 草稿生成中...'
                          : 'AI 重新生成修复草稿'}
                      </button>
                      {combatantRepair.isCooldown && (
                        <span className="text-xs text-gray-500">
                          Provider 冷却中（{combatantRepair.remainingTime}s）
                        </span>
                      )}
                      {!combatantRepair.canGenerateAiDraft && (
                        <span className="text-xs text-gray-500">
                          AI 草稿需要开启历战记录或当前状态写入；手动编辑仍可使用。
                        </span>
                      )}
                    </div>

                    <label className="block">
                      <span className="mb-1 block font-medium text-gray-700">手动编辑修复草稿</span>
                      <textarea
                        value={combatantRepair.draftText}
                        onChange={(event) => combatantRepair.setDraftText(event.target.value)}
                        rows={12}
                        spellCheck={false}
                        className="w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-xs leading-5 text-gray-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                        placeholder={'{"impacts":[{"combatantIndex":0,"characterName":"角色名","impact":"修复后的历战影响"}]}'}
                      />
                    </label>
                    <div className="text-xs text-gray-500">
                      可只提交需要修改的角色。重名角色必须保留 combatantIndex；也可粘贴 MAHOSHOJO_ARENA_META 内容。
                    </div>

                    {combatantRepair.repairError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                        {combatantRepair.repairError}
                      </div>
                    )}
                    {combatantRepair.repairNotice && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">
                        {combatantRepair.repairNotice}
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => combatantRepair.applyArenaRepairDraft()}
                        disabled={
                          isGenerating
                          || combatantRepair.isGeneratingDraft
                          || combatantRepair.isApplyingRepair
                          || combatantRepair.isCombatantMutationPending
                          || !combatantRepair.draftText.trim()
                        }
                        className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {combatantRepair.isApplyingRepair ? '应用中...' : '应用修复'}
                      </button>
                    </div>
                  </div>
                </CollapsibleSection>
              )}
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
                  </div>
                </CollapsibleSection>
              )}
              {updatedCombatants.length === 0 && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                  本次尚未产生可展示的角色更新。你可以点击“重试角色更新”，重试应用本次服务器已生成的历战记录/当前状态摘要。
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
