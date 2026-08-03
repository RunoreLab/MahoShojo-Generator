export interface FeatureConfig {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  href: string;
  className?: string;
  color?: string;
}

export interface FeatureCategory {
  id: string;
  title: string;
  columns: 1 | 2; // 1列或2列网格
  features: FeatureConfig[];
}

// 功能分类配置
export const featureCategories: FeatureCategory[] = [
  {
    id: 'character-generation',
    title: '~ 内容生成 ~',
    columns: 2,
    features: [
      {
        id: 'fairy-quest',
        src: '/questionnaire-logo.svg',
        width: 320,
        height: 50,
        alt: '奇妙妖精大调查',
        href: '/details',
        className: 'fairy-quest'
      },
      {
        id: 'canshou-generator',
        src: '/beast-logo-white.svg',
        width: 350,
        height: 50,
        alt: '危险残兽大调查',
        href: '/canshou',
        className: 'canshou-generator',
        color: 'white'
      },
      {
        id: 'magical-generator',
        src: '/logo-white.svg',
        width: 320,
        height: 80,
        alt: '魔法少女生成器',
        href: '/name',
        className: 'magical-generator',
        color: 'white'
      },
      {
        id: 'scenario-generator',
        src: '/scenario.webp',
        width: 350,
        height: 50,
        alt: '自定义情景生成',
        href: '/scenario',
        className: 'scenario-generator'
      }
    ]
  },
  {
    id: 'utilities',
    title: '~ 辅助功能 ~',
    columns: 2,
    features: [
      {
        id: 'free-generator',
        src: '/free-generator-white.svg',
        width: 240,
        height: 100,
        alt: '自由生成',
        href: '/free',
        className: 'free-generator'
      },
      {
        id: 'character-party',
        src: '/party-white.svg',
        width: 240,
        height: 100,
        alt: '角色组队',
        href: '/character-party',
        className: 'character-party',
        color: 'white'
      },
      {
        id: 'tavern-ecosystem',
        src: '/tavern-white.svg',
        width: 240,
        height: 100,
        alt: '酒馆生态',
        href: '/tavern',
        className: 'tavern-ecosystem',
        color: 'white'
      },
      {
        id: 'magic-tea-party',
        src: '/magic-tea-party-white.svg',
        width: 240,
        height: 100,
        alt: '魔法茶会',
        href: '/magic-tea-party',
        className: 'magic-tea-party',
        color: 'white'
      },
      {
        id: 'card-forge',
        src: '',
        width: 240,
        height: 100,
        alt: '卡牌工坊',
        href: '/card-forge',
        className: 'card-forge',
        color: 'white'
      }
    ]
  },
  {
    id: 'battle',
    title: '~ 对战竞技 ~',
    columns: 1,
    features: [
      {
        id: 'battle-arena',
        src: '/arena-white.svg',
        width: 240,
        height: 100,
        alt: '魔法少女竞技场',
        href: '/battle',
        className: 'battle-arena',
        color: 'white'
      },
      {
        id: 'pvp-arena',
        src: '/arena-card-white.webp',
        width: 240,
        height: 100,
        alt: 'PVP 卡牌对决',
        href: '/pvp',
        className: 'card-duel',
        color: 'white'
      }
    ]
  },
  {
    id: 'character-management',
    title: '~ 内容管理 ~',
    columns: 2,
    features: [
      {
        id: 'sublimation',
        src: '/sublimation-white.svg',
        width: 350,
        height: 50,
        alt: '角色成长升华',
        href: '/sublimation',
        className: 'sublimation'
      },
      {
        id: 'character-manager',
        src: '/character-manager-white.svg',
        width: 350,
        height: 50,
        alt: '角色数据管理',
        href: '/character-manager',
        className: 'character-manager'
      }
    ]
  }
];

// 获取所有图片路径用于预加载
export const getAllFeatureImages = (): string[] => {
  return featureCategories.flatMap(category =>
    category.features.map(feature => feature.src)
  );
};
