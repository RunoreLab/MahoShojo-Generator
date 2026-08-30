import { inferTemplate } from '@/lib/data-card-converter';

import { shuffleInPlace } from './random';
import type { PvpCardRef, PvpCombatantType, PvpHandState, PvpRoomRules, PvpSnapshotRef } from './types';

export const inferPvpCombatantTypeFromJson = (data: unknown): PvpCombatantType => {
  const template = inferTemplate(data);
  if (template === 'magical-girl') return 'magical-girl';
  if (template === 'canshou') return 'canshou';
  return 'general-character';
};

export const requiresPvpSubmissionPhase = (rules: Pick<PvpRoomRules, 'submissionMode' | 'cardsPerPlayer'>): boolean => {
  return rules.submissionMode === 'hostOnly' || Math.floor(rules.cardsPerPlayer) > 0;
};

export const buildCardRefKey = (ref: PvpCardRef): string => {
  if (ref.kind === 'data_card') return `data_card:${ref.id}`;
  if (ref.kind === 'preset') return `preset:${ref.filename}`;
  return `snapshot:${ref.id}`;
};

export const dedupeCardRefs = (refs: PvpCardRef[]): PvpCardRef[] => {
  const seen = new Set<string>();
  const out: PvpCardRef[] = [];
  for (const ref of refs) {
    const key = buildCardRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

export interface DealSnapshotsOptions {
  playerCount: number;
  handSize: number;
  deck: PvpSnapshotRef[];
  allowDrawPile?: boolean;
}

export const dealSnapshots = (options: DealSnapshotsOptions): { hands: PvpHandState[] } | { error: string } => {
  const playerCount = Math.floor(options.playerCount);
  const handSize = Math.floor(options.handSize);
  if (!Number.isFinite(playerCount) || playerCount <= 0) return { error: '无效的玩家数量' };
  if (!Number.isFinite(handSize) || handSize <= 0) return { error: '无效的手牌数量' };

  const deck = [...options.deck];
  shuffleInPlace(deck);

  const needed = playerCount * handSize;
  if (deck.length < needed) {
    return { error: `卡池不足：需要 ${needed} 张，实际仅 ${deck.length} 张` };
  }

  const hands: PvpHandState[] = Array.from({ length: playerCount }, () => ({
    cards: [],
    discarded: [],
    drawPile: [],
  }));

  for (let i = 0; i < needed; i++) {
    const card = deck[i]!;
    hands[i % playerCount]!.cards.push(card);
  }

  if (options.allowDrawPile) {
    const rest = deck.slice(needed);
    for (const h of hands) {
      h.drawPile = rest;
    }
  }

  return { hands };
};

export type WinnerCanonical = 'A' | 'B' | 'draw' | 'invalid';

export const normalizeWinner = (raw: string | null | undefined, aName: string, bName: string): WinnerCanonical => {
  if (!raw) return 'invalid';
  const text = raw.trim();
  if (!text) return 'invalid';

  const hasA = text.includes(aName);
  const hasB = text.includes(bName);
  const hasDraw = text.includes('平局') || text.toLowerCase() === 'draw';

  if (hasDraw && !hasA && !hasB) return 'draw';
  if (hasA && !hasB) return 'A';
  if (hasB && !hasA) return 'B';
  return 'invalid';
};

export type WinnerMultiCanonical =
  | { kind: 'draw' }
  | { kind: 'index'; index: number }
  | { kind: 'invalid'; matchedIndexes: number[] };

const stripWinnerText = (text: string): string => {
  return text
    .trim()
    .replace(/^[\s"'“”‘’]+/g, '')
    .replace(/[\s"'“”‘’]+$/g, '')
    .trim();
};

export const normalizeWinnerFromCandidates = (
  raw: string | null | undefined,
  candidateNames: string[],
): WinnerMultiCanonical => {
  if (!raw) return { kind: 'invalid', matchedIndexes: [] };
  const stripped = stripWinnerText(raw);
  if (!stripped) return { kind: 'invalid', matchedIndexes: [] };

  if (stripped === '平局' || stripped.toLowerCase() === 'draw') return { kind: 'draw' };

  const exactIndex = candidateNames.findIndex((name) => name === stripped);
  if (exactIndex >= 0) return { kind: 'index', index: exactIndex };

  const matchedIndexes = candidateNames
    .map((name, index) => (raw.includes(name) ? index : -1))
    .filter((index) => index >= 0);

  if (matchedIndexes.length === 1) return { kind: 'index', index: matchedIndexes[0]! };
  return { kind: 'invalid', matchedIndexes };
};
