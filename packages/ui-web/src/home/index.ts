/**
 * 共源首页切片。
 *
 * ## 抽的是哪几块
 *
 * 品牌 Hero、功能分组网格、百科入口卡、账号欢迎区与产品目录共源。
 * 目录（`HOME_FEATURE_CATEGORIES`）是产品事实，**不代表**任一宿主已交付全部入口——
 * 可用性由宿主能力快照投影，未交付的入口按策略隐藏或说明，不渲染死链。
 *
 * ## 刻意不抽的是什么
 *
 * Web 的 `HomePage` 还挂着 `useAuth()`、`UserWithTitle` 与浏览器 `preload()`，
 * `app/page.tsx` 会提前预载全部功能图。这些是 Web 在线启动流程的一部分，
 * `DESK-PROD-004` 明确禁止本地壳自动请求项目服务。把整个组件搬进共享包等于把那些
 * 行为一起拖进 Desktop——那不是共源，是把一个宿主的启动流程固化进产品。
 *
 * 因此两个 app 各自组装：欢迎语里的「用户是谁」由宿主注入已验证身份，页脚的站外
 * 打开动作由宿主能力决定，共源部分在中间。
 */
export {
  HomeAccountWelcome,
  HomeEncyclopediaCard,
  HomeFeatureGrid,
  HomeHero,
  type HomeAccountWelcomeLink,
  type HomeAccountWelcomeProps,
  type HomeEncyclopediaCardProps,
  type HomeFeatureGridProps,
  type HomeHeroProps,
} from './HomeView';

export {
  HOME_FEATURE_CATEGORIES,
  HOME_RECOMMENDED_ENTRIES,
  getHomeFeatureAssets,
  homeAssetUrl,
  type HomeAssetSource,
  type HomeFeature,
  type HomeFeatureCategory,
} from './feature-catalog';
