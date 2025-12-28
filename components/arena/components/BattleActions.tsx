'use client';

import { useState } from 'react';

import { formatDateTime } from '@/lib/constants';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleEngine } from '../hooks/useBattleEngine';
import { BattleStoreState } from '../types';
import { NarrativeHistoryModal } from './NarrativeHistoryModal';
import { useNarrativeHistoryStore } from '../stores/useNarrativeHistoryStore';

const estimateTokens = (text: string): number => {
  if (!text) return 0;
  let cjk = 0;
  let nonCjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      nonCjk += 1;
      continue;
    }
    // 粗略识别 CJK：更接近“1 字≈1 token”的直觉；其余按非 CJK 计入分摊
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjk += 1;
    } else {
      nonCjk += 1;
    }
  }
  return Math.max(1, Math.ceil(cjk + nonCjk / 4));
};

const normalizeArenaHistoryReadLimitForEstimate = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return 3;
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
  const selectedLevel = useBattleSelector((state) => state.selectedLevel);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const settings = useBattleSelector((state) => state.settings);
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

    const combatantPayload = readableCombatants.map((combatant) => {
      const raw = combatant.data;
      if (!raw || typeof raw !== 'object') {
        return { type: combatant.type, data: raw };
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
      return { type: combatant.type, data: clone };
    });

    const teams: Record<number, string[]> = {};
    readableCombatants.forEach((combatant) => {
      const teamId = combatant.teamId;
      if (!teamId) return;
      const name = combatant.data?.codename || combatant.data?.name || '';
      if (!name) return;
      if (!teams[teamId]) teams[teamId] = [];
      teams[teamId].push(name);
    });

    const narrativeHistoryPayload = settings.readNarrativeHistory
      ? [...narrativeEntries]
          .filter((entry) => typeof entry?.content === 'string' && entry.content.trim())
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          .map((entry) => ({ title: entry.title, content: entry.content }))
      : undefined;

    const payload: Record<string, unknown> = {
      mode: battleMode,
      selectedLevel,
      language: selectedLanguage,
      storyLength,
      userGuidance: settings.userGuidance,
      readArenaHistory: settings.readArenaHistory,
      arenaHistoryReadLimit: arenaHistoryReadLimitForEstimate,
      readCurrentState: settings.readCurrentState,
      readNarrativeHistory: settings.readNarrativeHistory,
      narrativeHistory: narrativeHistoryPayload,
      combatants: combatantPayload,
      ...(battleMode === 'scenario' ? { scenario: scenario.content } : {}),
      ...(battleMode === 'scenario' && auxScenarios.length > 0 ? { auxScenarios: auxScenarios.map((s) => s.content) } : {}),
      ...(Object.keys(teams).length > 0 ? { teams } : {}),
    };

    try {
      return JSON.stringify(payload);
    } catch {
      return '';
    }
  })();

  const estimatedTokens = estimatePayloadText ? estimateTokens(estimatePayloadText) : 0;
  const MAX_ESTIMATE_TOKENS = 16000;
  const ratio = MAX_ESTIMATE_TOKENS > 0 ? Math.min(1, estimatedTokens / MAX_ESTIMATE_TOKENS) : 0;
  const barColor =
    ratio <= 0.5
      ? 'bg-emerald-500'
      : ratio <= 0.75
        ? 'bg-yellow-500'
        : ratio <= 0.9
          ? 'bg-orange-500'
          : 'bg-red-600';
  const shouldWarn = estimatedTokens >= 12000;

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

      <div className="mt-2 flex items-center justify-center gap-2">
        <div className="h-2 w-40 bg-gray-200 rounded-full overflow-hidden" title="估算仅供参考，不等同于真实 Token">
          <div className={`h-full ${barColor}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="text-xs text-gray-600 tabular-nums" title="估算仅供参考，不等同于真实 Token">
          ~{estimatedTokens.toLocaleString()} tokens
        </div>
      </div>
      {shouldWarn && (
        <div className="mt-1 text-xs text-orange-600 text-center">
          ⚠️ 预计上下文较长，可能更易超时/失败。可尝试关闭“叙事历史读取”或“历战记录读取”，或减少历史条目/参战角色。
        </div>
      )}

      <NarrativeHistoryModal isOpen={showNarrativeModal} onClose={() => setShowNarrativeModal(false)} />
    </>
  );
}
