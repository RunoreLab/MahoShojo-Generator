'use client';

import { useState } from 'react';

import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { formatDateTime } from '@/lib/constants';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleEngine } from '../hooks/useBattleEngine';
import { BattleStoreState } from '../types';
import { NarrativeHistoryModal } from './NarrativeHistoryModal';
import { useNarrativeHistoryStore } from '../stores/useNarrativeHistoryStore';

const normalizeArenaHistoryReadLimitForEstimate = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return 3;
};

const normalizeNarrativeHistoryReadLimitForEstimate = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return 10;
};

const trimArenaHistoryEntriesForEstimate = (
  entries: unknown[],
  otherParticipantNames: string[],
  isPureBattle: boolean,
  limit: number | null
): unknown[] => {
  let relevantEntries = entries.filter((entry) => entry && typeof entry === 'object');

  if (isPureBattle) {
    relevantEntries = relevantEntries.filter((entry) => {
      const metadata = (entry as any)?.metadata;
      return !metadata?.user_guidance && !metadata?.scenario_title;
    });
  }

  relevantEntries.sort((a, b) => {
    const aParticipants = Array.isArray((a as any)?.participants) ? (a as any).participants : [];
    const bParticipants = Array.isArray((b as any)?.participants) ? (b as any).participants : [];
    const aIsRelevant = aParticipants.some((p: unknown) => typeof p === 'string' && otherParticipantNames.includes(p));
    const bIsRelevant = bParticipants.some((p: unknown) => typeof p === 'string' && otherParticipantNames.includes(p));
    if (aIsRelevant && !bIsRelevant) return -1;
    if (!aIsRelevant && bIsRelevant) return 1;

    const aId = typeof (a as any)?.id === 'number' && Number.isFinite((a as any).id) ? (a as any).id : 0;
    const bId = typeof (b as any)?.id === 'number' && Number.isFinite((b as any).id) ? (b as any).id : 0;
    return bId - aId;
  });

  if (limit === null) return relevantEntries;
  if (typeof limit === 'number' && limit > 0) return relevantEntries.slice(0, limit);
  return relevantEntries.slice(0, 20);
};

const trimArenaHistoryForEstimate = (
  history: unknown,
  otherParticipantNames: string[],
  isPureBattle: boolean,
  limit: number | null
): unknown => {
  if (!history || typeof history !== 'object') return history;
  const rawEntries = (history as any).entries;
  if (!Array.isArray(rawEntries)) return history;
  const trimmedEntries = trimArenaHistoryEntriesForEstimate(rawEntries, otherParticipantNames, isPureBattle, limit);
  return { ...(history as Record<string, unknown>), entries: trimmedEntries };
};

const buttonTextMap: Record<string, string> = {
  daily: '生成日常故事 (´｡• ᵕ •｡`) ♡',
  kizuna: '生成宿命对决 (๑•̀ㅂ•́)و✧',
  classic: '生成独家新闻 _φ(❐_❐✧',
  scenario: '开始演绎情景 (´｡• ᵕ •｡`)',
};

export function BattleActions() {
  const { handleGenerate, isGenerating, isCooldown, remainingTime } = useBattleEngine();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const settings = useBattleSelector((state) => state.settings);
  const teamsState = useBattleSelector((state) => state.teams);
  const [showNarrativeModal, setShowNarrativeModal] = useState(false);
  const narrativeCount = useNarrativeHistoryStore((state) => state.entries.length);
  const narrativeLastUpdatedAt = useNarrativeHistoryStore((state) => state.lastUpdatedAt);
  const narrativeEntries = useNarrativeHistoryStore((state) => state.entries);

  const estimatePayloadText = (() => {
    const readableCombatants = combatants.filter((item): item is any => 'data' in item);
    const allNames: string[] = readableCombatants
      .map((combatant) => {
        const name = combatant?.data?.codename || combatant?.data?.name;
        return typeof name === 'string' ? name.trim() : '';
      })
      .filter((name) => Boolean(name));
    const isPureBattle =
      !settings.userGuidance?.trim() &&
      !(battleMode === 'scenario' && scenario?.content) &&
      !(battleMode === 'scenario' && auxScenarios.length > 0);
    const arenaHistoryReadLimitForEstimate =
      settings.readArenaHistory && !settings.isArenaHistoryUnlimited
        ? normalizeArenaHistoryReadLimitForEstimate(settings.readArenaHistoryLimit)
        : settings.readArenaHistory
          ? null
          : undefined;
    const narrativeHistoryReadLimitForEstimate =
      settings.readNarrativeHistory && !settings.isNarrativeHistoryUnlimited
        ? normalizeNarrativeHistoryReadLimitForEstimate(settings.readNarrativeHistoryLimit)
        : settings.readNarrativeHistory
          ? null
          : undefined;

    const combatantPayload = readableCombatants.map((combatant) => {
      const raw = combatant.data;
      if (!raw || typeof raw !== 'object') {
        return { type: combatant.type, data: raw, teamId: typeof combatant.teamId === 'number' ? combatant.teamId : null };
      }
      const clone: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
      if (!settings.readArenaHistory) delete clone.arena_history;
      if (!settings.readCurrentState) delete clone.current_state;
      if (settings.readArenaHistory && 'arena_history' in clone) {
        const name = typeof (raw as any)?.codename === 'string' ? (raw as any).codename.trim() : (raw as any)?.name;
        const characterName = typeof name === 'string' ? name.trim() : '';
        const otherNames = characterName ? allNames.filter((n) => n !== characterName) : allNames;
        clone.arena_history = trimArenaHistoryForEstimate(
          clone.arena_history,
          otherNames,
          isPureBattle,
          typeof arenaHistoryReadLimitForEstimate === 'undefined' ? 3 : arenaHistoryReadLimitForEstimate
        );
      }
      return { type: combatant.type, data: clone, teamId: typeof combatant.teamId === 'number' ? combatant.teamId : null };
    });

    const teams: Record<number, string[]> = {};
    const teamNamesById = new Map<number, string>(
      teamsState.map((team) => [team.id, typeof team.name === 'string' ? team.name.trim() : ''] as const)
    );

    readableCombatants.forEach((combatant) => {
      const teamId = combatant.teamId;
      if (!teamId) return;
      const name = combatant.data?.codename || combatant.data?.name || '';
      if (!name) return;
      if (!teams[teamId]) teams[teamId] = [];
      teams[teamId].push(name);
    });

    const teamNames: Record<number, string> = {};
    Object.keys(teams).forEach((key) => {
      const teamId = Number(key);
      const name = teamNamesById.get(teamId);
      if (name) teamNames[teamId] = name;
    });

    const narrativeHistoryPayload = settings.readNarrativeHistory
      ? (() => {
        const sorted = [...narrativeEntries]
          .filter((entry) => typeof entry?.content === 'string' && entry.content.trim())
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

        const limited =
          narrativeHistoryReadLimitForEstimate === null
            ? sorted
            : typeof narrativeHistoryReadLimitForEstimate === 'number' && Number.isFinite(narrativeHistoryReadLimitForEstimate)
              ? sorted.slice(Math.max(0, sorted.length - Math.max(1, Math.floor(narrativeHistoryReadLimitForEstimate))))
              : sorted.slice(Math.max(0, sorted.length - 10));

        return limited.map((entry) => ({ title: entry.title, content: entry.content }));
      })()
      : undefined;

    const payload: Record<string, unknown> = {
      mode: battleMode,
      language: selectedLanguage,
      storyLength,
      userGuidance: settings.userGuidance,
      readArenaHistory: settings.readArenaHistory,
      arenaHistoryReadLimit: arenaHistoryReadLimitForEstimate,
      readCurrentState: settings.readCurrentState,
      readNarrativeHistory: settings.readNarrativeHistory,
      narrativeHistoryReadLimit: narrativeHistoryReadLimitForEstimate,
      narrativeHistory: narrativeHistoryPayload,
      combatants: combatantPayload,
      ...(battleMode === 'scenario' ? { scenario: scenario.content } : {}),
      ...(battleMode === 'scenario' && auxScenarios.length > 0 ? { auxScenarios: auxScenarios.map((s) => s.content) } : {}),
      ...(Object.keys(teams).length > 0 ? { teams, ...(Object.keys(teamNames).length > 0 ? { teamNames } : {}) } : {}),
    };

    try {
      return JSON.stringify(payload);
    } catch {
      return '';
    }
  })();

  const getButtonText = () => {
    if (isCooldown) return `记者赶稿中...请等待 ${remainingTime} 秒`;
    if (isGenerating) {
      switch (battleMode) {
        case 'daily':
          return '撰写日常逸闻中... (｡･ω･｡)ﾉ';
        case 'kizuna':
          return '描绘宿命对决中... (ง •̀_•́)ง';
        case 'classic':
          return '推演激烈战斗中... (ง •̀_•́)ง';
        case 'scenario':
          return '演绎指定剧本中... (｡･ω･｡)ﾉ';
        default:
          return '生成中...';
      }
    }
    return buttonTextMap[battleMode] || '生成战报';
  };

  return (
    <>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          onClick={() => handleGenerate()}
          disabled={
            isGenerating ||
            isCooldown ||
            (battleMode === 'daily' || battleMode === 'scenario'
              ? combatants.length < 1
              : combatants.length < 2)
          }
          className="generate-button"
        >
          {getButtonText()}
        </button>
      </div>

      <CollapsibleSection
        title="高级：叙事历史 / 上下文估算"
        description="当生成失败或耗时过长时，建议从这里开始排查"
        defaultOpen={false}
        storageKey="arena.section.generateAdvanced.open"
        className="mt-3"
      >
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowNarrativeModal(true)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            disabled={isGenerating}
            title="查看/编辑叙事历史记录"
          >
            叙事历史：{narrativeCount} 条{narrativeLastUpdatedAt ? `｜${formatDateTime(narrativeLastUpdatedAt)}` : ''}
          </button>
        </div>

        <TokenIndicator
          text={estimatePayloadText}
          warningText="⚠️ 预计上下文较长，可能更易超时/失败。可尝试关闭“叙事历史读取”或“历战记录读取”，或减少历史条目/参战角色。"
        />
      </CollapsibleSection>

      <NarrativeHistoryModal isOpen={showNarrativeModal} onClose={() => setShowNarrativeModal(false)} />
    </>
  );
}
