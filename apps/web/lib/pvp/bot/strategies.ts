import type { BotCandidateCard, BotStrategy, BotStrategyId, RandomFn } from './types';

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const pickWeightedIndex = (weights: number[], rng: RandomFn): number | null => {
  const safeWeights = weights.map((w) => (Number.isFinite(w) ? Math.max(0, w) : 0));
  const total = safeWeights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  let r = rng() * total;
  for (let i = 0; i < safeWeights.length; i++) {
    r -= safeWeights[i]!;
    if (r <= 0) return i;
  }
  return safeWeights.length - 1;
};

const pickRandomIndex = (count: number, rng: RandomFn): number | null => {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(rng() * n);
};

const containsAny = (text: string, keywords: string[]): boolean => {
  if (!text) return false;
  for (const kw of keywords) {
    if (kw && text.includes(kw)) return true;
  }
  return false;
};

const DEFAULT_WEIGHT_BASE = 1;
const DEFAULT_WEIGHT_MAX = 3;
const DEFAULT_WEIGHT_SATURATION = 30; // 越小越“更快到顶”，可按体验调参

export const computeDefaultCardWeight = (card: BotCandidateCard): number => {
  const stats = card.dataCardStats;
  if (!stats || !stats.isPublic) return DEFAULT_WEIGHT_BASE;

  const raw = (stats.usageCount ?? 0) + (stats.likeCount ?? 0) + (stats.favoriteCount ?? 0) * 3;
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WEIGHT_BASE;

  // 使用“指数饱和”把 raw 压缩到 [0,2]，并保证最终权重 ∈ [1,3]
  const bonus = 2 * (1 - Math.exp(-raw / DEFAULT_WEIGHT_SATURATION));
  return clamp(DEFAULT_WEIGHT_BASE + bonus, DEFAULT_WEIGHT_BASE, DEFAULT_WEIGHT_MAX);
};

const DEFAULT_STRATEGY: BotStrategy = {
  id: 'default_weighted',
  label: '默认',
  description: '按公开库热度加权随机（使用+点赞+收藏×3，且权重上限=基础×3）',
  pickSnapshotId: (cards, rng) => {
    if (!Array.isArray(cards) || cards.length <= 0) return null;
    const weights = cards.map((c) => computeDefaultCardWeight(c));
    const index = pickWeightedIndex(weights, rng);
    return index === null ? null : cards[index]?.snapshotId ?? null;
  },
};

const RANDOM_STRATEGY: BotStrategy = {
  id: 'random',
  label: '随机',
  description: '所有手牌等权随机打出',
  pickSnapshotId: (cards, rng) => {
    const index = pickRandomIndex(cards.length, rng);
    return index === null ? null : cards[index]?.snapshotId ?? null;
  },
};

const COPYCAT_STRATEGY: BotStrategy = {
  id: 'copycat',
  label: '偷师',
  description: '优先选择手牌里“真人玩家提交者胜率最高”的卡；否则回退默认策略',
  pickSnapshotId: (cards, rng) => {
    const humanCards = cards.filter((c) => !c.ownerIsBot);
    if (humanCards.length <= 0) return DEFAULT_STRATEGY.pickSnapshotId(cards, rng);

    let bestRate = -1;
    for (const c of humanCards) {
      const rate = Number.isFinite(c.ownerWinRate) ? (c.ownerWinRate as number) : 0;
      bestRate = Math.max(bestRate, rate);
    }
    const best = humanCards.filter((c) => (Number.isFinite(c.ownerWinRate) ? c.ownerWinRate : 0) === bestRate);
    const index = pickRandomIndex(best.length, rng);
    return index === null ? DEFAULT_STRATEGY.pickSnapshotId(cards, rng) : best[index]?.snapshotId ?? null;
  },
};

const POWER_KEYWORDS = ['大道至简', '代码'];
const KEYWORD_BOOST_MULTIPLIER = 1.4;

const KEYWORD_BOOST_STRATEGY: BotStrategy = {
  id: 'keyword_boost',
  label: '强度词条',
  description: '对包含特定高强度设定关键词的卡牌增加权重（仍受权重上限约束）',
  pickSnapshotId: (cards, rng) => {
    if (!Array.isArray(cards) || cards.length <= 0) return null;
    const weights = cards.map((c) => {
      let weight = computeDefaultCardWeight(c);
      const text = `${c.snapshotName}\n${(c.snapshotDataJson || '').slice(0, 2000)}`;
      if (containsAny(text, POWER_KEYWORDS)) {
        weight = clamp(weight * KEYWORD_BOOST_MULTIPLIER, DEFAULT_WEIGHT_BASE, DEFAULT_WEIGHT_MAX);
      }
      return weight;
    });
    const index = pickWeightedIndex(weights, rng);
    return index === null ? null : cards[index]?.snapshotId ?? null;
  },
};

export const BOT_STRATEGIES: BotStrategy[] = [
  DEFAULT_STRATEGY,
  RANDOM_STRATEGY,
  COPYCAT_STRATEGY,
  KEYWORD_BOOST_STRATEGY,
];

export const getBotStrategyById = (id: string): BotStrategy => {
  const found = BOT_STRATEGIES.find((s) => s.id === id);
  return found ?? DEFAULT_STRATEGY;
};

export const pickBotStrategyId = (rng: RandomFn): BotStrategyId => {
  const ids = BOT_STRATEGIES.map((s) => s.id);
  const index = pickRandomIndex(ids.length, rng);
  return (index === null ? DEFAULT_STRATEGY.id : (ids[index] as BotStrategyId)) ?? DEFAULT_STRATEGY.id;
};

