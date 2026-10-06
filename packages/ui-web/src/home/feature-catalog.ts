/**
 * 共源首页展示契约与产品目录（D5.1-P1 自 `apps/web/config/features.ts` 迁入）。
 *
 * 这里描述的是**产品目录**——名称、分组、图标资源与产品路径——而不是宿主可用性。
 * 共源目录不承诺任何一端已交付全部入口：Web 的全部可用，Desktop 由能力快照投影出
 * 已交付子集（`DESK-PARITY-002`），未交付的入口按宿主策略隐藏或说明，绝不渲染成死链。
 */

export interface HomeFeature {
  readonly id: string;
  /** 相对 `content/brand/` 的资源文件名，例如 `logo.svg`。 */
  readonly assetFile: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** 产品路径。宿主据此查能力快照决定它是否可点。 */
  readonly href: string;
  readonly className?: string;
  /** 深色底上的资源需要浅色文字描边，与既有 Web 形态一致。 */
  readonly onDark?: boolean;
}

export interface HomeFeatureCategory {
  readonly id: string;
  readonly title: string;
  /** 网格列数。1 用于宽幅资源，2 用于并排的紧凑资源。 */
  readonly columns: 1 | 2;
  readonly features: readonly HomeFeature[];
}

/**
 * 宿主提供的品牌资源服务根。
 *
 * 与百科正文一样，只有 base 是宿主事实：Web 由 `public/` 提供，Desktop 由 Tauri 自定义协议伺服
 * `dist/`。两端当前都是 origin 根，但那是当前事实而不是可以写死的约定。
 */
export interface HomeAssetSource {
  readonly baseUrl: string;
}

export const homeAssetUrl = (source: HomeAssetSource, assetFile: string): string => {
  const base = source.baseUrl.endsWith('/') ? source.baseUrl.slice(0, -1) : source.baseUrl;
  return `${base}/${assetFile}`;
};

/** 返回宿主已选择渲染的功能资源。 */
export const getHomeFeatureAssets = (
  features: readonly HomeFeature[],
): readonly string[] => features.map((feature) => feature.assetFile);

/**
 * 首页功能分组目录——产品事实的唯一定义处。
 *
 * `assetFile` 指向 `content/brand/` 权威源；两端 public 副本由 `generate-encyclopedia-content`
 * 同步产物提供。新增入口时同步检查渐变 class（`product-shell.css`）与两端交付状态，
 * 不要把 Desktop 尚未交付的路径误标成可用——那由能力快照而不是这份目录决定。
 */
export const HOME_FEATURE_CATEGORIES: readonly HomeFeatureCategory[] = [
  {
    id: 'character-generation',
    title: '~ 内容生成 ~',
    columns: 2,
    features: [
      {
        id: 'fairy-quest',
        assetFile: 'questionnaire-logo.svg',
        width: 320,
        height: 50,
        alt: '奇妙妖精大调查',
        href: '/details',
        className: 'fairy-quest',
      },
      {
        id: 'canshou-generator',
        assetFile: 'beast-logo-white.svg',
        width: 350,
        height: 50,
        alt: '危险残兽大调查',
        href: '/canshou',
        className: 'canshou-generator',
        onDark: true,
      },
      {
        id: 'magical-generator',
        assetFile: 'logo-white.svg',
        width: 320,
        height: 80,
        alt: '魔法少女生成器',
        href: '/name',
        className: 'magical-generator',
        onDark: true,
      },
      {
        id: 'scenario-generator',
        assetFile: 'scenario.webp',
        width: 350,
        height: 50,
        alt: '自定义情景生成',
        href: '/scenario',
        className: 'scenario-generator',
      },
    ],
  },
  {
    id: 'utilities',
    title: '~ 辅助功能 ~',
    columns: 2,
    features: [
      {
        id: 'free-generator',
        assetFile: 'free-generator-white.svg',
        width: 240,
        height: 100,
        alt: '自由生成',
        href: '/free',
        className: 'free-generator',
      },
      {
        id: 'character-party',
        assetFile: 'party-white.svg',
        width: 240,
        height: 100,
        alt: '角色组队',
        href: '/character-party',
        className: 'character-party',
        onDark: true,
      },
      {
        id: 'tavern-ecosystem',
        assetFile: 'tavern-white.svg',
        width: 240,
        height: 100,
        alt: '酒馆生态',
        href: '/tavern',
        className: 'tavern-ecosystem',
        onDark: true,
      },
      {
        id: 'magic-tea-party',
        assetFile: 'magic-tea-party-white.svg',
        width: 240,
        height: 100,
        alt: '魔法茶会',
        href: '/magic-tea-party',
        className: 'magic-tea-party',
        onDark: true,
      },
      {
        id: 'card-forge',
        assetFile: 'card-forge-white.svg',
        width: 240,
        height: 100,
        alt: '卡牌工坊',
        href: '/card-forge',
        className: 'card-forge',
        onDark: true,
      },
    ],
  },
  {
    id: 'battle',
    title: '~ 对战竞技 ~',
    columns: 1,
    features: [
      {
        id: 'battle-arena',
        assetFile: 'arena-white.svg',
        width: 240,
        height: 100,
        alt: '魔法少女竞技场',
        href: '/battle',
        className: 'battle-arena',
        onDark: true,
      },
    ],
  },
  {
    id: 'character-management',
    title: '~ 内容管理 ~',
    columns: 2,
    features: [
      {
        id: 'sublimation',
        assetFile: 'sublimation-white.svg',
        width: 350,
        height: 50,
        alt: '角色成长升华',
        href: '/sublimation',
        className: 'sublimation',
      },
      {
        id: 'character-manager',
        assetFile: 'character-manager-white.svg',
        width: 350,
        height: 50,
        alt: '角色数据管理',
        href: '/character-manager',
        className: 'character-manager',
      },
    ],
  },
];

/**
 * 首页「新手推荐」的固定选位——产品事实而非宿主事实。
 *
 * 条目 slug 指向 `content/encyclopedia/` 的既有页面；新增推荐时先确认该 slug
 * 在两端的百科同步产物中都存在，否则渲染层会把未知条目静默丢掉。
 */
export const HOME_RECOMMENDED_ENTRIES = [
  { slug: 'site-guide', text: '站内功能速览（从生成到对战）' },
  { slug: 'newbie-guide', text: '新手攻略（强度直觉）' },
  { slug: 'community-rules', text: '社区守则与竞技场规范（必读）' },
] as const;
