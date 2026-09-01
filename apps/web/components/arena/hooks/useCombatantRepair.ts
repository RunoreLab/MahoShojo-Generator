'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArenaCharacterRepairPatch } from '@mahoshojo/domain/arena-character-repair';

import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import {
  normalizeArenaRepairDraft,
  prepareAndApplyArenaCombatantRepair,
} from '@/lib/arena/combatant-repair';
import { precheckBattleReportForRedo } from '@/lib/arena/redo-updates';
import { verifyArenaContentOrigin } from '@/lib/arena/verify-origin';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { useProviderModeCooldown } from '@/lib/cooldown';
import { authStorage } from '@/lib/auth';

import { useArenaRoomContext } from '../multiplayer/useArenaRoom';
import { useBattleStore } from '../stores/useBattleStore';
import type { BattleAiImpact, BattleStoreState, CombatantData } from '../types';
import { toBattleReportMarkdown } from '../utils/battleReportMarkdown';
import {
  ARENA_PROVIDER_COOLDOWN_BASE_KEY,
  resolveArenaProviderCooldownConfig,
} from '../utils/providerCooldown';

type RepairEndpointResponse = Readonly<{
  success?: unknown;
  impacts?: unknown;
  error?: unknown;
  message?: unknown;
}>;

const displayNameOf = (combatant: CombatantData): string => (
  (combatant.data?.codename || combatant.data?.name || '').toString().trim()
);

const seedDraftFromImpacts = (
  impacts: BattleAiImpact[] | null,
  combatants: CombatantData[],
): string => {
  if (!impacts?.length) return '';
  const names = combatants.map(displayNameOf);
  const patches = impacts.flatMap((impact) => {
    const matchingIndexes = names.reduce<number[]>((indices, name, index) => {
      if (name === impact.characterName.trim()) indices.push(index);
      return indices;
    }, []);
    if (matchingIndexes.length !== 1) return [];
    const combatantIndex = matchingIndexes[0]!;
    if (!impact.impact?.trim() && !impact.currentStateSummary?.trim()) return [];
    return [{
      combatantIndex,
      characterName: names[combatantIndex]!,
      ...(impact.impact?.trim() ? { impact: impact.impact.trim() } : {}),
      ...(impact.currentStateSummary?.trim()
        ? { currentStateSummary: impact.currentStateSummary.trim() }
        : {}),
    }];
  });
  return patches.length > 0 ? JSON.stringify({ impacts: patches }, null, 2) : '';
};

const describeRepairFailure = (result: Readonly<{
  reason: string;
  issues?: readonly Readonly<{ message: string }>[];
}>): string => {
  if (result.reason === 'trust-downgrade-cancelled') return '已取消创建非原生可编辑版本。';
  if (result.reason === 'missing-effect-cancelled') return '已取消创建缺失的本次角色 effect。';
  const details = result.issues?.map((issue) => issue.message).filter(Boolean).join('；');
  if (result.reason === 'ambiguous-generation-effect') {
    return details || '同一 generation 存在多条角色记录，无法安全判断修复目标。';
  }
  if (result.reason === 'generation-effect-not-found') {
    return details || '未找到本次 generation 对应的角色 effect。';
  }
  return details || '修复草稿无效。';
};

export const useCombatantRepair = () => {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => (
    useBattleStore(selector)
  );
  const combatants = useBattleSelector((state) => state.combatants);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const streamingMarkdown = useBattleSelector((state) => state.streamingMarkdown);
  const newsReport = useBattleSelector((state) => state.newsReport);
  const lastGenerationId = useBattleSelector((state) => state.lastGenerationId);
  const repairAppliedGenerationId = useBattleSelector((state) => state.repairAppliedGenerationId);
  const latestAiImpacts = useBattleSelector((state) => state.latestAiImpacts);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const settings = useBattleSelector((state) => state.settings);
  const scenario = useBattleSelector((state) => state.scenario);
  const userProviderConfig = useBattleSelector((state) => state.userProviderConfig);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const isCombatantMutationPending = useBattleSelector(
    (state) => state.isCombatantMutationPending,
  );
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const setUpdatedCombatants = useBattleSelector((state) => state.setUpdatedCombatants);
  const setLatestAiImpacts = useBattleSelector((state) => state.setLatestAiImpacts);
  const setRepairAppliedGenerationId = useBattleSelector(
    (state) => state.setRepairAppliedGenerationId,
  );
  const arenaRoomRuntime = useArenaRoomContext();
  const isInRoom = Boolean(arenaRoomRuntime?.state.session);

  const providerCooldownConfig = resolveArenaProviderCooldownConfig(userProviderConfig);
  const { isCooldown, remainingTime, startCooldown } = useProviderModeCooldown({
    baseKey: ARENA_PROVIDER_COOLDOWN_BASE_KEY,
    ...providerCooldownConfig,
  });

  const [draftText, setDraftText] = useState('');
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isApplyingRepair, setIsApplyingRepair] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);
  const draftGenerationRef = useRef<string | null>(null);
  const seededGenerationRef = useRef<string | null>(null);

  const roster = useMemo(
    () => combatants.filter((item): item is CombatantData => 'data' in item),
    [combatants],
  );
  const reportMarkdown = useMemo(() => {
    if (generationMode === 'stream') return streamingMarkdown?.trim() ?? '';
    return newsReport ? toBattleReportMarkdown(newsReport) : '';
  }, [generationMode, newsReport, streamingMarkdown]);

  const repairContextIsCurrent = useCallback((
    generationId: string,
    capturedRoster: readonly CombatantData[],
  ): boolean => {
    if (arenaRoomRuntime?.controller.getSnapshot().session) return false;
    const currentState = useBattleStore.getState();
    if (currentState.lastGenerationId !== generationId) return false;
    const currentRoster = currentState.combatants.filter(
      (item): item is CombatantData => 'data' in item,
    );
    return currentRoster.length === capturedRoster.length
      && currentRoster.every((combatant, index) => combatant === capturedRoster[index]);
  }, [arenaRoomRuntime]);

  useEffect(() => {
    if (draftGenerationRef.current === lastGenerationId) return;
    draftGenerationRef.current = lastGenerationId;
    seededGenerationRef.current = null;
    setDraftText('');
    setRepairError(null);
    setRepairNotice(null);
  }, [lastGenerationId]);

  useEffect(() => {
    if (!lastGenerationId || seededGenerationRef.current === lastGenerationId) return;
    if (draftText.trim() || !latestAiImpacts?.length) return;
    const seededDraft = seedDraftFromImpacts(latestAiImpacts, roster);
    if (!seededDraft) return;
    seededGenerationRef.current = lastGenerationId;
    setDraftText(seededDraft);
  }, [draftText, lastGenerationId, latestAiImpacts, roster]);

  const generateAiRepairDraft = useCallback(async () => {
    if (isInRoom) {
      setRepairError('多人房间结果保持只读；请离开房间后在普通单人战报中使用角色修复。');
      return;
    }
    if (!lastGenerationId || roster.length === 0) {
      setRepairError('本次战报缺少 generationId 或角色 roster，无法生成修复草稿。');
      return;
    }
    if (!settings.writeArenaHistory && !settings.writeCurrentState) {
      setRepairError('请先开启历战记录或当前状态写入，再生成 AI 修复草稿。');
      return;
    }
    if (isCooldown) {
      setRepairError(`当前 Provider 通道仍在冷却中，请等待 ${remainingTime} 秒。`);
      return;
    }

    setIsGeneratingDraft(true);
    setRepairError(null);
    setRepairNotice(null);
    try {
      const customProvider = buildCustomProviderRequestPayload(userProviderConfig);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const authHeader = await authStorage.getAuthHeader();
      if (authHeader) headers.Authorization = authHeader;
      Object.assign(headers, await authStorage.getActivityHeaders());
      const response = await fetch('/api/arena/repair-combatant-meta', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          generationId: lastGenerationId,
          combatants: roster.map((combatant) => ({
            type: combatant.type,
            data: combatant.data,
            isNative: combatant.isValid,
            isPreset: combatant.isPreset,
          })),
          battleReportMarkdown: reportMarkdown,
          mode: battleMode,
          userGuidance: settings.userGuidance,
          scenario: battleMode === 'scenario' ? scenario.content : undefined,
          writeArenaHistory: settings.writeArenaHistory,
          writeCurrentState: settings.writeCurrentState,
          ...(customProvider ? { customProvider } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as RepairEndpointResponse;
      if (!response.ok) {
        throw new Error(formatHttpErrorMessage({
          serverMessage: payload.error ?? payload.message,
          status: response.status,
          fallback: '生成角色修复草稿失败',
        }));
      }
      const normalized = await normalizeArenaRepairDraft({
        draft: JSON.stringify({ impacts: payload.impacts }),
        combatants: roster,
      });
      if (!repairContextIsCurrent(lastGenerationId, roster)) {
        throw new Error('角色或 generation 上下文已变化，旧的 AI 修复草稿已丢弃。');
      }
      setDraftText(JSON.stringify({ impacts: normalized }, null, 2));
      setRepairNotice('AI 修复草稿已生成；请检查并编辑，确认后再应用。');
      startCooldown();
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : '生成角色修复草稿失败。');
    } finally {
      setIsGeneratingDraft(false);
    }
  }, [
    battleMode,
    isCooldown,
    isInRoom,
    lastGenerationId,
    remainingTime,
    repairContextIsCurrent,
    reportMarkdown,
    roster,
    scenario.content,
    settings.userGuidance,
    settings.writeArenaHistory,
    settings.writeCurrentState,
    startCooldown,
    userProviderConfig,
  ]);

  const applyArenaRepairDraft = useCallback(async () => {
    if (isInRoom) {
      setRepairError('多人房间结果保持只读；请离开房间后在普通单人战报中使用角色修复。');
      return;
    }
    if (!lastGenerationId || roster.length === 0) {
      setRepairError('本次战报缺少 generationId 或角色 roster，无法应用修复。');
      return;
    }
    const report = precheckBattleReportForRedo(reportMarkdown, battleMode);
    if (!report.ok) {
      setRepairError(report.error);
      return;
    }
    if (!useBattleStore.getState().tryBeginCombatantMutation()) {
      setRepairError('角色更新正在进行，请等待当前操作完成后再应用修复。');
      return;
    }

    setIsApplyingRepair(true);
    setRepairError(null);
    setRepairNotice(null);
    try {
      const patches = await normalizeArenaRepairDraft({ draft: draftText, combatants: roster });
      const result = await prepareAndApplyArenaCombatantRepair({
        combatants: roster,
        generationId: lastGenerationId,
        patches,
        nowISO: new Date().toISOString(),
        createHistoryEntry: {
          type: battleMode,
          title: report.parsed.headline,
          participants: roster.map(displayNameOf),
          winner: report.parsed.winner,
          metadata: {
            user_guidance: settings.userGuidance.trim() || null,
            scenario_title: battleMode === 'scenario'
              ? (scenario.content?.title ?? scenario.content?.name ?? scenario.fileName ?? null)
              : null,
            non_native_data_involved: true,
          },
        },
        verifyNative: verifyArenaContentOrigin,
        confirmTrustDowngrade: (names) => window.confirm(
          `角色「${names.join('、')}」具有原生或 canonical 来源。继续会创建非原生可编辑版本，服务器不会重新签名，源角色不会被自动覆盖。是否继续？`,
        ),
        confirmCreateMissingEffects: () => window.confirm(
          '部分角色未找到本次 generation 的历战记录或当前状态。是否为本次战报创建明确标记的自定义 effect？',
        ),
      });
      if (!result.ok) {
        setRepairError(describeRepairFailure(result));
        return;
      }
      if (result.status === 'no-op') {
        setRepairNotice('草稿内容与当前角色数据相同，未修改角色，也未改变其信任状态。');
        return;
      }
      if (!repairContextIsCurrent(lastGenerationId, roster)) {
        setRepairError('角色、generation 或 Room 上下文已变化，本次修复未写入。');
        return;
      }

      let readableIndex = 0;
      const mergedCombatants = combatants.map((combatant) => {
        if (!('data' in combatant)) return combatant;
        const repaired = result.combatants[readableIndex];
        readableIndex += 1;
        return repaired ?? combatant;
      });
      setCombatants(mergedCombatants);
      setUpdatedCombatants(result.combatants.map((combatant) => combatant.data));
      setLatestAiImpacts(patches.map((patch: ArenaCharacterRepairPatch) => ({
        characterName: patch.characterName,
        ...(patch.impact ? { impact: patch.impact } : {}),
        ...(patch.currentStateSummary
          ? { currentStateSummary: patch.currentStateSummary }
          : {}),
      })));
      setRepairAppliedGenerationId(lastGenerationId);
      const createdCount = result.createdEffects.length;
      setRepairNotice(
        `已应用 ${result.changedCombatantIndices.length} 位角色的非原生修复${
          createdCount > 0 ? `，其中 ${createdCount} 位创建了缺失 effect` : ''
        }。同 generation 的服务器权威重试已禁用。`,
      );
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : '应用角色修复失败。');
    } finally {
      useBattleStore.getState().endCombatantMutation();
      setIsApplyingRepair(false);
    }
  }, [
    battleMode,
    combatants,
    draftText,
    isInRoom,
    lastGenerationId,
    reportMarkdown,
    repairContextIsCurrent,
    roster,
    scenario.content,
    scenario.fileName,
    setCombatants,
    setLatestAiImpacts,
    setRepairAppliedGenerationId,
    setUpdatedCombatants,
    settings.userGuidance,
  ]);

  return {
    draftText,
    setDraftText,
    generateAiRepairDraft,
    applyArenaRepairDraft,
    isGeneratingDraft,
    isApplyingRepair,
    isCombatantMutationPending,
    repairError,
    repairNotice,
    isCooldown,
    remainingTime,
    isInRoom,
    hasRepairContext: Boolean(lastGenerationId && roster.length > 0 && reportMarkdown),
    isRepairAppliedForGeneration: Boolean(
      lastGenerationId && repairAppliedGenerationId === lastGenerationId,
    ),
    canGenerateAiDraft: Boolean(
      settings.writeArenaHistory || settings.writeCurrentState
    ),
    isGenerating,
  };
};
