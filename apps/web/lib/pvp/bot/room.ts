import type { PvpHandState, PvpRoomRules, PvpSubmissionPayload } from '@/lib/pvp/types';
import { parsePvpRules } from '@/lib/pvp/validate';

import type { BotStrategyId } from './types';

export type PvpRoomBotState = {
  id: string;
  name: string;
  seat: number;
  strategyId: BotStrategyId;
  submission: PvpSubmissionPayload;
  hand?: PvpHandState;
  choicesByRoundId?: Record<string, string>;
};

export type PvpRoomBotRosterItem = {
  id: string;
  name: string;
  seat: number;
};

export type PvpRoomInternalState = {
  rules: PvpRoomRules;
  bots: PvpRoomBotState[];
  raw: Record<string, unknown>;
};

export const parsePvpRoomInternalState = (rulesJson: string): { internal: PvpRoomInternalState } | { error: string } => {
  let raw: any;
  try {
    raw = JSON.parse(rulesJson) as any;
  } catch {
    return { error: '房间规则损坏' };
  }

  const parsed = parsePvpRules(raw);
  if ('error' in parsed) return { error: parsed.error };

  const botsRaw = (raw && typeof raw === 'object') ? (raw as any)._bots : null;
  const bots = Array.isArray(botsRaw) ? (botsRaw as any[]) : [];
  const normalizedBots: PvpRoomBotState[] = bots
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const id = typeof b.id === 'string' ? b.id.trim() : '';
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      const seat = Number.isFinite((b as any).seat) ? Math.floor((b as any).seat) : null;
      const strategyId = typeof (b as any).strategyId === 'string' ? String((b as any).strategyId).trim() : 'default_weighted';
      const submission = (b as any).submission as PvpSubmissionPayload | undefined;
      if (!id || !name || seat === null) return null;
      if (!submission || !Array.isArray((submission as any).cards)) return null;

      const hand = (b as any).hand as PvpHandState | undefined;
      const safeHand =
        hand && typeof hand === 'object' && Array.isArray((hand as any).cards) && Array.isArray((hand as any).discarded)
          ? hand
          : undefined;

      const choicesByRoundIdRaw = (b as any).choicesByRoundId;
      const choicesByRoundId: Record<string, string> = {};
      if (choicesByRoundIdRaw && typeof choicesByRoundIdRaw === 'object') {
        for (const [k, v] of Object.entries(choicesByRoundIdRaw as Record<string, unknown>)) {
          const key = typeof k === 'string' ? k.trim() : '';
          const value = typeof v === 'string' ? v.trim() : '';
          if (key && value) choicesByRoundId[key] = value;
        }
      }

      return {
        id,
        name,
        seat,
        strategyId: strategyId as BotStrategyId,
        submission,
        hand: safeHand,
        choicesByRoundId: Object.keys(choicesByRoundId).length > 0 ? choicesByRoundId : undefined,
      } satisfies PvpRoomBotState;
    })
    .filter(Boolean) as PvpRoomBotState[];

  const rawObj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  return { internal: { rules: parsed.rules, bots: normalizedBots, raw: rawObj } };
};

export const stringifyPvpRoomInternalState = (internal: PvpRoomInternalState): string => {
  const next = { ...(internal.raw || {}), ...(internal.rules as any), _bots: internal.bots } as Record<string, unknown>;
  return JSON.stringify(next);
};

export const parsePvpRoomBotRoster = (raw: Record<string, unknown> | null | undefined): PvpRoomBotRosterItem[] => {
  const listRaw = raw && typeof raw === 'object' ? (raw as any)._botRoster : null;
  if (!Array.isArray(listRaw)) return [];
  return (listRaw as any[])
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = typeof (item as any).id === 'string' ? String((item as any).id).trim() : '';
      const name = typeof (item as any).name === 'string' ? String((item as any).name).trim() : '';
      const seat = Number.isFinite((item as any).seat) ? Math.floor((item as any).seat) : null;
      if (!id || !name || seat == null || seat < 0) return null;
      return { id, name, seat } satisfies PvpRoomBotRosterItem;
    })
    .filter(Boolean) as PvpRoomBotRosterItem[];
};

export const clearBotsFromRulesJson = (rulesJson: string): string => {
  try {
    const raw = JSON.parse(rulesJson) as any;
    if (!raw || typeof raw !== 'object') return rulesJson;
    if (!('_bots' in raw)) return rulesJson;
    delete raw._bots;
    return JSON.stringify(raw);
  } catch {
    return rulesJson;
  }
};

/**
 * 清理房间规则 JSON 中的“对局运行时字段”（重开房间时使用）。
 * 注意：不会清理房间配置（如 _scenario、规则字段等）。
 */
export const clearPvpRoomRuntimeFromRulesJson = (rulesJson: string): string => {
  try {
    const raw = JSON.parse(rulesJson) as any;
    if (!raw || typeof raw !== 'object') return rulesJson;

    delete raw._bots;
    delete raw._postRound;
    delete raw._winnerVote;
    delete raw._drawPile;
    delete raw._usedPile;
    delete raw._publicDrawnCardIds;
    delete raw._submittedDataCardIds;
    delete raw._presetDrawnFilenames;
    delete raw._submittedPresetFilenames;

    return JSON.stringify(raw);
  } catch {
    return rulesJson;
  }
};

export const botUserIdForClient = (seat: number): number => {
  const s = Number.isFinite(seat) ? Math.floor(seat) : 0;
  return -1 - Math.max(0, s);
};
