import { inferCharacterKind } from '@mahoshojo/domain/data-cards';
import { isPvpCombatantTypeAllowedByRange, isPvpDataCardStatsAllowedByRange, normalizePvpRoomCardRange, type PvpCombatantType, type PvpRoomCardRange } from './arena-card-range';
type PvpCardRef = { kind: 'data_card'; id: string; updatedAt: string | null } | { kind: 'preset'; filename: string } | { kind: 'snapshot'; id: string };
type PvpRoomRules = { cardsPerPlayer: number; cardRange?: PvpRoomCardRange };
export type PvpSubmittedCard = { ref: Exclude<PvpCardRef, { kind: 'snapshot' }>; name: string; type: PvpCombatantType; dataJson: string; source: { isPublic: boolean; authorUsername?: string | null } };
export type PvpSubmissionPayload = { cards: PvpSubmittedCard[]; hasPrivateCard: boolean };
export type PvpPublicCard = { id: string; name: string; data: string; updated_at: string | null; username: string | null; like_count: number | null; usage_count: number | null; favorite_count: number | null };
export type PvpSubmissionPorts = {
  getRandomPublicCard(_type: 'character', _stats: Omit<PvpRoomCardRange, 'allowedCombatantTypes'>): Promise<PvpPublicCard | null>;
  presetFilenames: string[];
  loadPresetCard(_origin: string, _filename: string, _headers?: RequestInit['headers']): Promise<{ name: string; type: PvpCombatantType; dataJson: string }>;
};
export const inferPvpCombatantTypeFromJson = (data: unknown): PvpCombatantType => {
  const kind = inferCharacterKind(data);
  return kind === 'magical-girl' || kind === 'canshou' ? kind : 'general-character';
};
type Rng = () => number;

const buildRefKey = (ref: PvpCardRef): string => {
  if (ref.kind === 'data_card') return `data_card:${ref.id}`;
  if (ref.kind === 'preset') return `preset:${ref.filename}`;
  return `snapshot:${ref.id}`;
};

const pickOne = <T>(items: T[], rng: Rng): T | null => {
  if (!Array.isArray(items) || items.length <= 0) return null;
  const index = Math.floor(rng() * items.length);
  return items[index] ?? null;
};

export async function buildBotSubmissionPayload(ports: PvpSubmissionPorts, options: {
  rules: Pick<PvpRoomRules, 'cardsPerPlayer' | 'cardRange'>;
  origin: string;
  forwardHeaders?: RequestInit['headers'];
  excludeRefKeys?: Set<string>;
  rng?: Rng;
}): Promise<PvpSubmissionPayload> {
  const rng = options.rng ?? Math.random;
  const needed = Math.max(0, Math.floor(options.rules.cardsPerPlayer));
  const cardRange = normalizePvpRoomCardRange(options.rules);

  const used = new Set<string>();
  for (const key of options.excludeRefKeys ?? []) used.add(key);

  const cards: PvpSubmittedCard[] = [];

  const tryAddDataCard = async (allowDuplicateWithRoom: boolean): Promise<boolean> => {
    const statsOptions = {
      minLikeCount: cardRange.minLikeCount,
      maxLikeCount: cardRange.maxLikeCount,
      minUsageCount: cardRange.minUsageCount,
      maxUsageCount: cardRange.maxUsageCount,
      minFavoriteCount: cardRange.minFavoriteCount,
      maxFavoriteCount: cardRange.maxFavoriteCount,
    };
    const row = await ports.getRandomPublicCard('character', statsOptions);
    if (!row) return false;

    const id = typeof row.id === 'string' ? row.id : '';
    const name = typeof row.name === 'string' ? row.name : '未命名';
    const dataJson = typeof row.data === 'string' ? row.data : '';
    const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
    const authorUsername = typeof row.username === 'string' ? row.username : null;
    if (!id || !dataJson) return false;

    const ref = { kind: 'data_card', id, updatedAt } as const;
    const key = buildRefKey(ref);
    if (!allowDuplicateWithRoom && used.has(key)) return false;

    let parsed: unknown;
    try {
      parsed = JSON.parse(dataJson) as unknown;
    } catch {
      return false;
    }

    const type = inferPvpCombatantTypeFromJson(parsed);
    if (!isPvpCombatantTypeAllowedByRange(type, cardRange)) return false;

    const likeCount = Number.isFinite(row.like_count) ? Number(row.like_count) : null;
    const usageCount = Number.isFinite(row.usage_count) ? Number(row.usage_count) : null;
    const favoriteCount = Number.isFinite(row.favorite_count) ? Number(row.favorite_count) : null;
    if (!isPvpDataCardStatsAllowedByRange({ likeCount, usageCount, favoriteCount }, cardRange)) return false;

    cards.push({
      ref,
      name,
      type,
      dataJson,
      source: { isPublic: true, authorUsername },
    });
    used.add(key);
    return true;
  };

  const tryAddPreset = async (allowDuplicateWithRoom: boolean): Promise<boolean> => {
    const filename = pickOne(ports.presetFilenames, rng);
    if (!filename) return false;
    const ref = { kind: 'preset', filename } as const;
    const key = buildRefKey(ref);
    if (!allowDuplicateWithRoom && used.has(key)) return false;

    let preset: Awaited<ReturnType<typeof ports.loadPresetCard>>;
    try {
      preset = await ports.loadPresetCard(options.origin, filename, options.forwardHeaders);
    } catch {
      return false;
    }

    if (!isPvpCombatantTypeAllowedByRange(preset.type, cardRange)) return false;

    cards.push({
      ref,
      name: preset.name,
      type: preset.type,
      dataJson: preset.dataJson,
      source: { isPublic: true },
    });
    used.add(key);
    return true;
  };

  // Phase 1：尽量不与房间内其它提交重复
  for (let attempt = 0; attempt < 120 && cards.length < needed; attempt++) {
    const preferDataCard = rng() < 0.7;
    const ok = preferDataCard ? await tryAddDataCard(false) : await tryAddPreset(false);
    if (!ok) {
      // 互相兜底一次
      await (preferDataCard ? tryAddPreset(false) : tryAddDataCard(false));
    }
  }

  // Phase 2：候选不足时允许与房间重复，但仍尽量避免 Bot 自己内部重复（used 仍保留）
  for (let attempt = 0; attempt < 120 && cards.length < needed; attempt++) {
    const preferDataCard = rng() < 0.7;
    const ok = preferDataCard ? await tryAddDataCard(true) : await tryAddPreset(true);
    if (!ok) {
      await (preferDataCard ? tryAddPreset(true) : tryAddDataCard(true));
    }
  }

  // 最终兜底：仍不足则直接截断返回（后续由调用方决定是否允许开局）
  return { cards: cards.slice(0, needed), hasPrivateCard: false };
}
