export type ReporterTierRule = {
  badgeId: string;
  name: string;
  description: string;
  slotIncrement: number;
  minTotalLikes: number;
  minTotalFavorites: number;
  minTotalUsage: number;
};

export type BadgeUpsertDefinition = {
  id: string;
  name: string;
  description: string;
  iconJson: string;
  textColorJson: string;
  backgroundColorJson: string;
  borderColorJson?: string | null;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
};

export const REPORTER_TIERS: ReporterTierRule[] = [
  {
    badgeId: 'excellent_reporter',
    name: '优秀记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥3、累计被收藏 ≥1、累计使用量 ≥20，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 128,
    minTotalLikes: 3,
    minTotalFavorites: 1,
    minTotalUsage: 20,
  },
  {
    badgeId: 'hot_reporter',
    name: '热门记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥8、累计被收藏 ≥5、累计使用量 ≥100，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 64,
    minTotalLikes: 8,
    minTotalFavorites: 5,
    minTotalUsage: 100,
  },
  {
    badgeId: 'senior_reporter',
    name: '资深记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥20、累计被收藏 ≥15、累计使用量 ≥250，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 48,
    minTotalLikes: 20,
    minTotalFavorites: 15,
    minTotalUsage: 250,
  },
  {
    badgeId: 'ace_reporter',
    name: '王牌记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥80、累计被收藏 ≥60、累计使用量 ≥700，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 32,
    minTotalLikes: 80,
    minTotalFavorites: 60,
    minTotalUsage: 700,
  },
  {
    badgeId: 'chief_reporter',
    name: '首席记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥200、累计被收藏 ≥150、累计使用量 ≥1500，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 16,
    minTotalLikes: 200,
    minTotalFavorites: 150,
    minTotalUsage: 1500,
  },
];

export const REPORTER_BADGE_DEFINITIONS: BadgeUpsertDefinition[] = [
  {
    id: 'excellent_reporter',
    name: '优秀记者',
    description: REPORTER_TIERS[0].description,
    iconJson: '{"type":"lucide","name":"Newspaper"}',
    textColorJson: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColorJson: '{"type":"solid","value":"#ff0073"}',
    borderColorJson: '{"type":"solid","value":"#ff0073"}',
    rarity: 50,
    sortOrder: 12,
    isActive: true,
  },
  {
    id: 'hot_reporter',
    name: '热门记者',
    description: REPORTER_TIERS[1].description,
    iconJson: '{"type":"lucide","name":"TrendingUp"}',
    textColorJson: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #ff0073, #ff8a00)"}',
    borderColorJson: '{"type":"solid","value":"#ff8a00"}',
    rarity: 60,
    sortOrder: 21,
    isActive: true,
  },
  {
    id: 'senior_reporter',
    name: '资深记者',
    description: REPORTER_TIERS[2].description,
    iconJson: '{"type":"lucide","name":"Medal"}',
    textColorJson: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #7c3aed, #ff0073)"}',
    borderColorJson: '{"type":"solid","value":"#7c3aed"}',
    rarity: 70,
    sortOrder: 22,
    isActive: true,
  },
  {
    id: 'ace_reporter',
    name: '王牌记者',
    description: REPORTER_TIERS[3].description,
    iconJson: '{"type":"lucide","name":"Award"}',
    textColorJson: '{"type":"solid","value":"#1f2937"}',
    backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #fde68a, #f59e0b)"}',
    borderColorJson: '{"type":"solid","value":"#f59e0b"}',
    rarity: 80,
    sortOrder: 23,
    isActive: true,
  },
  {
    id: 'chief_reporter',
    name: '首席记者',
    description: REPORTER_TIERS[4].description,
    iconJson: '{"type":"lucide","name":"Crown"}',
    textColorJson: '{"type":"solid","value":"#111827"}',
    backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #fef3c7, #f97316)"}',
    borderColorJson: '{"type":"solid","value":"#f97316"}',
    rarity: 90,
    sortOrder: 24,
    isActive: true,
  },
];

export function getReporterTierByBadgeId(badgeId: string): ReporterTierRule | undefined {
  return REPORTER_TIERS.find((tier) => tier.badgeId === badgeId);
}

