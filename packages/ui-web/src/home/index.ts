/**
 * 共源首页切片。
 *
 * ## 抽的是哪几块
 *
 * 品牌 Hero、功能分组网格、百科入口卡与展示契约共源。功能清单由宿主按实际交付范围提供，
 * Web 的完整功能目录不作为 Desktop 的交付承诺。
 *
 * ## 刻意不抽的是什么
 *
 * Web 的 `HomePage` 还挂着 `useAuth()`、`UserWithTitle`、Footer、`ThemeImage` 与浏览器 `Image()`
 * 预加载，`app/page.tsx` 还会提前 preload 全部功能图。这些是 Web 在线启动流程的一部分，
 * `DESK-PROD-004` 明确禁止本地壳自动请求项目服务。把整个组件搬进共享包等于把那些行为一起拖进
 * Desktop——那不是共源，是把一个宿主的启动流程固化进产品。
 *
 * 因此两个 app 各自组装：Web 加账号欢迎与 Footer，Desktop 加自己的一句说明，共源部分在中间。
 */
export {
  HomeEncyclopediaCard,
  HomeFeatureGrid,
  HomeHero,
  type HomeEncyclopediaCardProps,
  type HomeFeatureGridProps,
  type HomeHeroProps,
} from './HomeView';

export {
  getHomeFeatureAssets,
  homeAssetUrl,
  type HomeAssetSource,
  type HomeFeature,
  type HomeFeatureCategory,
} from './feature-catalog';
