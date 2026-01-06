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
      '发表公开且通过审查的数据卡，累计获赞 ≥5、累计被收藏 ≥3、累计使用量 ≥30，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 128,
    minTotalLikes: 5,
    minTotalFavorites: 3,
    minTotalUsage: 30,
  },
  {
    badgeId: 'hot_reporter',
    name: '热门记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥12、累计被收藏 ≥8、累计使用量 ≥150，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 64,
    minTotalLikes: 12,
    minTotalFavorites: 8,
    minTotalUsage: 150,
  },
  {
    badgeId: 'senior_reporter',
    name: '资深记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥30、累计被收藏 ≥20、累计使用量 ≥350，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 48,
    minTotalLikes: 30,
    minTotalFavorites: 20,
    minTotalUsage: 350,
  },
  {
    badgeId: 'ace_reporter',
    name: '王牌记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥100、累计被收藏 ≥70、累计使用量 ≥800，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 32,
    minTotalLikes: 100,
    minTotalFavorites: 70,
    minTotalUsage: 800,
  },
  {
    badgeId: 'chief_reporter',
    name: '首席记者',
    description:
      '发表公开且通过审查的数据卡，累计获赞 ≥250、累计被收藏 ≥160、累计使用量 ≥1700，即可获得本徽章，并额外增加卡槽。',
    slotIncrement: 16,
    minTotalLikes: 250,
    minTotalFavorites: 160,
    minTotalUsage: 1700,
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

