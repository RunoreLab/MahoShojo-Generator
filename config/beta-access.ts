export type BetaAccessFeatureId = 'magic-tea-party' | 'magic-tavern' | 'tachie';

export type BetaAccessRequirement =
  | {
      type: 'badge';
      badgeNames: string[];
      badgeIds?: string[];
      label: string;
    }
  | {
      type: 'publicUsage';
      min: number;
      label: string;
    }
  | {
      type: 'publicFavorites';
      min: number;
      label: string;
    }
  | {
      type: 'publicCards';
      min: number;
      label: string;
    };

export type BetaAccessRequirementGroup = {
  allOf?: BetaAccessRequirement[];
  anyOf?: BetaAccessRequirement[];
};

export type BetaAccessFeatureConfig = {
  id: BetaAccessFeatureId;
  title: string;
  summary: string;
  href: string;
  showRequirements?: boolean;
  requirements: BetaAccessRequirementGroup;
};

const magicTavernRequirements: BetaAccessRequirementGroup = {
  anyOf: [
    {
      type: 'badge',
      badgeNames: ['老资历'],
      badgeIds: ['old_exp'],
      label: '持有「老资历」徽章',
    },
    {
      type: 'publicUsage',
      min: 500,
      label: '公开卡累计使用量 ≥ 500',
    },
  ],
};

const tachieRequirements: BetaAccessRequirementGroup = {
  allOf: [
    {
      type: 'publicCards',
      min: 1,
      label: '公开卡数量 ≥ 1',
    },
    {
      type: 'badge',
      badgeNames: ['先行者'],
      badgeIds: ['forerunner'],
      label: '持有「先行者」徽章',
    },
    {
      type: 'publicFavorites',
      min: 5,
      label: '公开卡累计收藏量 ≥ 5',
    },
  ],
};

export const betaAccessConfig: {
  showRequirementsByDefault: boolean;
  features: Record<BetaAccessFeatureId, BetaAccessFeatureConfig>;
} = {
  showRequirementsByDefault: true,
  features: {
    'magic-tea-party': {
      id: 'magic-tea-party',
      title: '魔法茶会',
      summary: '参加魔法茶会需得到魔法少女们的认可。',
      href: '/magic-tea-party',
      showRequirements: true,
      requirements: magicTavernRequirements,
    },
    'magic-tavern': {
      id: 'magic-tavern',
      title: '魔法茶馆',
      summary: '参加魔法茶会需得到魔法少女们的认可。',
      href: '/magic-tavern',
      showRequirements: true,
      requirements: magicTavernRequirements,
    },
    tachie: {
      id: 'tachie',
      title: '立绘生成',
      summary: '唯有受选中之人能推开魔法画室的门扉。',
      href: '/tachie',
      showRequirements: true,
      requirements: tachieRequirements,
    },
  },
};
