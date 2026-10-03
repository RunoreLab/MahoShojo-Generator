/**
 * 共源首页功能目录。
 *
 * 它是 13 个功能入口与 4 个分组的**产品定义**：标题、顺序、目标路径与展示尺寸都在这里。Web 原先在
 * `apps/web/config/features.ts` 持有这份数据，D3.0 把它搬到这里，两个 app 从同一份读。
 *
 * ## `assetFile` 而不是 URL
 *
 * 原字段是 `src: '/questionnaire-logo.svg'`，也就是 public-root 绝对 URL。那是 Web 的寻址约定：
 * Desktop 由 Tauri 自定义协议伺服产物，origin 与路径前缀都不保证同形。目录因此只声明**资源的逻辑
 * 文件名**，最终 URL 由宿主注入的 `HomeAssetSource` 解析——与百科正文的 `contentFile` 同一套做法。
 *
 * 引用完整性由 `scripts/generate-encyclopedia-content.mjs --check` 把关：品牌资源同步到两个 app 时，
 * 这里声明的文件必须真的存在于 `content/brand/`。
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

/**
 * 全部分组。
 *
 * 13 个入口里大部分在 Desktop 尚未交付。共享层**不**在这里判断可用性——那是宿主能力快照的事
 * （`DESK-PROD-001`）。这份目录只回答「产品有哪些功能入口」，因此 D3.1/D3.2/D3.3 交付后新增的
 * 入口在这里加一行就能在两端同时出现，不需要改任何视图代码。
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
      {
        id: 'pvp-arena',
        assetFile: 'arena-card-white.webp',
        width: 240,
        height: 100,
        alt: 'PVP 卡牌对决',
        href: '/pvp',
        className: 'card-duel',
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

export const homeAssetUrl = (source: HomeAssetSource, assetFile: string): string => {
  const base = source.baseUrl.endsWith('/') ? source.baseUrl.slice(0, -1) : source.baseUrl;
  return `${base}/${assetFile}`;
};

/**
 * 需要预加载的品牌资源。
 *
 * 抽出来是因为两端都要在首屏前把这些图拉进来，而**只有实际渲染的入口**才需要预载：把 13 张全部
 * 预载会让一个刚打开的桌面应用立刻请求十几张还没显示的图（`DESK-PROD-004`）。
 */
export const getHomeFeatureAssets = (
  features: readonly HomeFeature[],
): readonly string[] => features.map((feature) => feature.assetFile);