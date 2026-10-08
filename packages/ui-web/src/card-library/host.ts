import type { ComponentType, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type {
  DataCardSummaryPage,
  DataCardSummaryQueryInput,
  OnlineDataCardType,
} from '@mahoshojo/contracts/data-cards';

import type { BadgeDefinition, UserBadge } from './badge-types';
import type { CardLibrarySummarySource } from './use-card-library-summary-page';

/**
 * 数据卡选择器（CardLibraryModal）的宿主端口（D5.0e，`DESK-ONLINE-010`）。
 *
 * Web 的 `BattleDataModal` 把「界面行为」和「运行地能力」混在一个文件里：
 * next/link、浏览器 localStorage、`/api/*` fetch、IndexedDB 本地库。这里的端口把
 * 两类事实分开——交互/排序/分页/页签语义留在共享组件内，而「请求怎么发、标记存哪、
 * 链接怎么跳、详情长什么样」由宿主注入。
 *
 * 端口刻意是窄的、可辨识的（每个可选能力都有显式的"不存在"表示），宿主不能通过
 * 「不传端口」悄悄关掉某个语义；不实现的能力表现为 UI 上不出现该入口。
 */

/** 宿主链接组件：Web 是 `next/link`，Desktop 是 router 内导航（`preventDefault` + navigate）。 */
export interface CardLibraryLinkProps {
  href: string;
  className?: string;
  title?: string;
  target?: string;
  rel?: string;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  children?: ReactNode;
}
export type CardLibraryLinkComponent = ComponentType<CardLibraryLinkProps>;

/**
 * 设备级「已点赞 / 已使用」标记存储。
 *
 * Web 用 localStorage（键 `mahoshojo_liked_cards` / `mahoshojo_used_cards`），
 * 跨标签页共享因而兼任点赞锁；Desktop 用 webview 的 localStorage 或宿主等价物。
 * `mark*` 返回 true 表示本次是首次标记——点赞流程依赖它防止重复上报。
 */
export interface CardLibraryMarks {
  isLiked(cardId: string): boolean;
  markLiked(cardId: string): boolean;
  isUsed(cardId: string): boolean;
  markUsed(cardId: string): boolean;
}

/**
 * 远端请求的传输结果面：与 `fetchJsonWithBoundedRetry` 的返回形状同构，
 * `status` 供调用方区分可重试传输错误与 4xx 业务终态。
 */
export type CardLibraryRemoteResult<T> =
  | { ok: true; status: number; data: T }
  // 失败分支的 data 是不可信正文（可能不是预期形状），调用方只读 status。
  | { ok: false; status: number; data?: unknown };

/**
 * 公开库列表查询参数。与 `/api/public-data-cards?view=summary` 的 query 一一对应；
 * 宿主负责把它序列化到自己的传输层（URLSearchParams 或 IPC 载荷）。
 */
export interface CardLibraryPublicListQuery {
  type: OnlineDataCardType;
  limit: number;
  offset: number;
  sortBy: 'likes' | 'usage' | 'favorites' | 'created_at';
  search?: string;
  tagIds?: readonly string[];
  tagMatch?: 'any' | 'all';
  author?: string;
  minLikes?: string;
  maxLikes?: string;
  minUsage?: string;
  maxUsage?: string;
  minFavorites?: string;
  maxFavorites?: string;
  /** 角色类型服务端过滤（仅 `type=character` 时有意义）。 */
  roleType?: 'magical-girl' | 'canshou' | 'general';
  recommendedOnly?: boolean;
  nativeOnly?: boolean;
  nativeAllowedOnly?: boolean;
}

/**
 * `/api/public-data-cards?view=summary` 的业务响应面（success 语义由 API 契约决定，
 * 不在这里收窄）。列表行是摘要投影——不携带 `data` 正文；`total`/`nextOffset`
 * 供服务端分页使用，旧式无分页响应可能缺省。
 */
export interface CardLibraryPublicListBody {
  success?: boolean;
  cards?: any[];
  total?: number;
  nextOffset?: number | null;
  error?: string;
}

/** `/api/public-data-cards?id=` 的单卡响应面。 */
export interface CardLibraryPublicCardBody {
  success?: boolean;
  card?: any;
  error?: string;
}

/** `/api/tags` 的 tag 行。 */
export interface CardLibraryTag {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: 'user' | 'system' | 'admin';
  isActive: boolean;
}

/** `/api/data-card-meta-batch` 的单卡技术值/段位投影。 */
export interface CardLibraryCardMeta {
  techScore: number | null;
  techLevel: string | null;
  strictTier: string | null;
  isNative: boolean | null;
}

/** `deckApi.getDeckCards` 的业务面：cards 元素带 isAccessible/card。 */
export interface CardLibraryDeckDetail {
  cards?: Array<{ isAccessible?: boolean; card?: any }>;
}

export type CardLibraryStatKind = 'usage' | 'like';

/**
 * 在线卡库通路。本端口存在即表示宿主实现了这些路由——不提供「半实现」：
 * 缺失的只读增强面（meta/徽章）单独声明为可选，其余都是核心交互的一部分。
 */
export interface CardLibraryOnlinePort {
  /** 「我的 / 收藏」分页摘要；返回值已过 `DataCardSummaryPageSchema` 校验。 */
  fetchSummaryPage(
    source: CardLibrarySummarySource,
    query: DataCardSummaryQueryInput,
    signal: AbortSignal,
  ): Promise<DataCardSummaryPage>;
  /** 公开库列表（含 recommendedOnly 标记）。 */
  fetchPublicCards(
    query: CardLibraryPublicListQuery,
    signal: AbortSignal,
  ): Promise<CardLibraryRemoteResult<CardLibraryPublicListBody>>;
  /** 公开库按 id 单卡（分享链接直达）。 */
  fetchPublicCardById(
    cardId: string,
    signal: AbortSignal,
  ): Promise<CardLibraryRemoteResult<CardLibraryPublicCardBody>>;
  /** 按需读取单卡完整正文；输入是列表行（含 storageLocation 语义者除外）。 */
  loadFullCard(card: unknown, source: 'my' | 'public', signal: AbortSignal): Promise<unknown>;
  /** 标签库；失败时返回 `{ ok: false, error }` 而非抛出（与 Web 现有错误文案语义一致）。 */
  listTags(signal: AbortSignal): Promise<{ ok: true; tags: CardLibraryTag[] } | { ok: false; error: string }>;
  /** 当前账号的收藏 id 集合（仅登录后调用）。 */
  listFavoriteIds(): Promise<{ success: boolean; favorites?: string[] }>;
  addFavorite(cardId: string): Promise<{ success?: boolean; alreadyExists?: boolean }>;
  removeFavorite(cardId: string): Promise<{ success?: boolean }>;
  /** 卡组导入的卡片明细（仅登录后调用；允许返回 null = 拉取失败）。 */
  getDeckCards(deckId: string): Promise<CardLibraryDeckDetail | null>;
  /** 点赞/使用统计上报；返回值即「服务端确认成功」。 */
  reportCardStat(cardId: string, stat: CardLibraryStatKind): Promise<boolean>;
  /** 可选增强：卡片技术值/段位批量查询；缺失/失败时静默降级（不显示）。 */
  fetchCardMetaBatch?(
    cardIds: readonly string[],
    signal: AbortSignal,
  ): Promise<Record<string, CardLibraryCardMeta> | null>;
  /** 可选增强：作者佩戴徽章批量查询；缺失/失败时静默降级。 */
  fetchAuthorBadgesBatch?(
    userIds: readonly number[],
    signal: AbortSignal,
  ): Promise<Record<number, BadgeDefinition[]> | null>;
  /**
   * 「本地 → 线上副本」显式上传。宿主不提供时本地行不出现该入口（D5.0e
   * 双向副本语义）。实现 MUST 创建**新的**线上记录并把可见性默认私有——
   * 本地记录没有服务器身份，这里不存在「更新线上原卡」的语义。
   * 失败必须返回 `{ok:false, error}`，不得删除或改写本地记录。
   */
  uploadLocalRecord?(
    record: LocalCardRecordV1,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

/* ── 公开库持久缓存读取端口（D5.1-K2，DESK-CACHE-004/005）──────────────── */

/** 缓存摘要查询参数：对齐 `CardLibraryPublicListQuery` 中投影确实携带的筛选面。 */
export interface CardLibraryCachedListQuery {
  type?: OnlineDataCardType;
  limit: number;
  offset: number;
  sortBy: 'likes' | 'usage' | 'favorites' | 'created_at';
  search?: string;
  tagIds?: readonly string[];
  tagMatch?: 'any' | 'all';
  author?: string;
  minLikes?: string;
  maxLikes?: string;
  minUsage?: string;
  maxUsage?: string;
  minFavorites?: string;
  maxFavorites?: string;
  roleType?: 'magical-girl' | 'canshou' | 'general';
  recommendedOnly?: boolean;
  /**
   * 刻意没有 `nativeOnly`：摘要投影不携带 isNative（来自 meta 侧表），
   * 诚实口径是禁用该筛选并说明，而不是猜零或真（`DESK-CACHE-004`）。
   */
  nativeAllowedOnly?: boolean;
}

/** 缓存读路径的状态面——与 native `public_read_cache_stats` 同口径。 */
export type CardLibraryCacheStatus = 'empty' | 'ready' | 'unavailable' | 'unsupported-schema';

/** 一条缓存命中：抓取时的公开摘要投影 + 正文可得性。 */
export interface CardLibraryCachedEntry {
  card: Record<string, unknown>;
  hasBody: boolean;
  lastSuccessAt: string | null;
  summaryUpdatedAt?: string | null;
  bodyUpdatedAt?: string | null;
}

/**
 * 摘要查询结果。`total`/`bodyCount` 是匹配本机缓存的行数——不是线上
 * total；`status` 非 'ready' 时 entries/total 为零值，调用方如实展示
 * 「缓存不可用/尚未建立」，不得说成「缓存里没有」。
 */
export interface CardLibraryCachedPage {
  status: CardLibraryCacheStatus;
  entries: CardLibraryCachedEntry[];
  total: number;
  bodyCount: number;
}

/** 单卡缓存可得性——撤回行绝不返回正文。 */
export type CardLibraryCachedAvailability = 'full' | 'summary-only' | 'absent' | 'withdrawn';

export interface CardLibraryCachedCardResult {
  status: CardLibraryCacheStatus;
  availability: CardLibraryCachedAvailability;
  entry?: {
    card: Record<string, unknown>;
    bodyUpdatedAt?: string | null;
    lastSuccessAt?: string | null;
  } | null;
}

/**
 * 公开资料持久缓存的宿主端口（Desktop native 提供；Web 不提供时公开库
 * 不产生「已缓存资料」入口，也不做离线降级）。
 *
 * 端口是只读的：写入只发生在 native 观察线上响应的捕获路径上，
 * renderer 不能经这里写缓存。
 */
export interface CardLibraryPublicCachePort {
  /** 摘要集合上的离线搜索/筛选/排序/分页。 */
  queryCachedCards(query: CardLibraryCachedListQuery, signal: AbortSignal): Promise<CardLibraryCachedPage>;
  /** 按 cardId 取单卡；`availability='full'` 时 entry.card 才带正文。 */
  loadCachedCard(cardId: string, signal: AbortSignal): Promise<CardLibraryCachedCardResult>;
  /** 「管理缓存」入口（Desktop → 设置「数据与存储」）；不提供时 UI 不出现该链接。 */
  openCacheManagement?(): void;
}

/**
 * 宿主提供的登录/账号投影。
 *
 * 三个取值有明确区分——`unknown` 表示「宿主尚未确认登录态」（Desktop 冷启动
 * `idle`/探测在途/授权在途/服务不可达），**不得**按「已登出」渲染或据此清理
 * 账号绑定状态；只有 `unauthenticated` 才是确认过的登出。`userId` 是业务
 * users.id（数值型），仅在 `authenticated` 时有值。
 */
export type CardLibraryAuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';
export interface CardLibraryAuthState {
  status: CardLibraryAuthStatus;
  userId: number | null;
  /** 当前用户佩戴的徽章（未登录为空数组）。 */
  userBadges: readonly UserBadge[];
}

/**
 * 卡片「这一次被选中」的来源身份（`onSelectCard`/`onToggleCard` 第二参数）。
 *
 * 只承担 UI/草稿答案的隔离语义——不是服务器凭据，也不得据此推断本地行拥有
 * 线上身份。同一 canonical 问卷/卡 id 的不同来源副本必须产出不同的
 * `selectionId`，否则宿主会把不同来源的草稿回答错投到同一份记录上
 * （与 Web 各页的 `selectionId` 语义统一；D5.0e-r1）。
 */
export interface CardLibrarySelectionContext {
  /**
   * 稳定且按来源隔离的标识：`cloud:<线上卡id>` / `local:<本机记录id>` /
   * `cache:<公开卡id>`（公开缓存快照——`DESK-CACHE-007` 的冻结输入；它
   * 不是已验证的线上引用，Strict/多人/权威写入照常由服务器重新验权）。
   */
  selectionId: string;
  storageLocation: 'local' | 'cloud' | 'cache';
  /** 仅云端行有值；本地行与缓存快照行 MUST NOT 产出（与 `_cardId === ''` 同一不变量）。 */
  cloudCardId?: string;
}

/** 本机本地库通路：设备拥有，不要求登录、不依赖网络。 */
export interface CardLibraryLocalPort {
  repository: CardRepository;
}

/** 详情模态框的卡片入参（与 Web `DataCardDetailsModal` 的 card prop 形状一致）。 */
export interface CardLibraryDetailsCard {
  id: string;
  name: string;
  description: string;
  type: OnlineDataCardType;
  /** 正文固定为 JSON 字符串（云端行直接是 string，本地行由 mapper 序列化）。 */
  data: string;
  isPublic: boolean;
  usageCount?: number;
  likeCount?: number;
  favoriteCount?: number;
  author?: string;
  authorBadges?: BadgeDefinition[];
  createdAt?: string;
  updatedAt?: string;
}

/** 详情模态框插槽的 props 契约（Web 由 `DataCardDetailsModal` 满足）。 */
export interface CardLibraryDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: CardLibraryDetailsCard;
  /** 「存到本地库」动作；缺省表示这张卡不提供复制入口（本地行）。 */
  onSaveCopyToLocalLibrary?: () => void;
  localLibrarySaveState?: { busy: boolean; message: string | null };
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

/** 卡组选择器插槽（Web `DecksModal`）。 */
export interface CardLibraryDecksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportDeck: (deckId: string) => void;
}

export interface CardLibrarySlots {
  /** 详情模态框；不提供时卡片上不出现「详情」入口。 */
  CardDetailsModal?: ComponentType<CardLibraryDetailsModalProps>;
  /** 卡组导入器；不提供时「卡组导入」按钮不出现。 */
  DecksModal?: ComponentType<CardLibraryDecksModalProps>;
  /** 「本地」页签顶部横幅（Web：持久化状态提示 + 本地库管理链接）。 */
  renderLocalLibraryBanner?: () => ReactNode;
  /** 「本地」页签空库说明块；不提供时使用共享默认文案与 `localLibraryLink`。 */
  renderLocalLibraryEmpty?: (context: { typeLabel: string; onRetry?: () => void }) => ReactNode;
  /** 「本地」空态里的「本地库说明」链接元素（默认文案路径使用）。 */
  localLibraryLink?: ReactNode;
}

/**
 * 宿主运行时能力。除 `downloadJson` 外都是必需面——缺失会让交互语义残缺。
 * `downloadJson` 不提供时下载/导出按钮自动禁用（桌面端未接保存对话框前成立）。
 */
export interface CardLibraryPlatform {
  Link: CardLibraryLinkComponent;
  marks: CardLibraryMarks;
  /** 分享文案复制；宿主实现内做剪贴板降级。 */
  copyText(text: string): Promise<void>;
  /** 把 JSON 文本交给用户（浏览器 `<a download>` / native 保存对话框）。 */
  downloadJson?(fileName: string, jsonText: string): void;
}

export interface CardLibraryHost {
  auth: CardLibraryAuthState;
  online: CardLibraryOnlinePort;
  local: CardLibraryLocalPort;
  platform: CardLibraryPlatform;
  slots: CardLibrarySlots;
  /**
   * 公开资料持久缓存（D5.1-K2）。宿主提供时公开库页签获得「已缓存」视图
   * 与在线失败时的自动降级；不提供时公开库行为与既有线上路径完全一致。
   */
  publicCache?: CardLibraryPublicCachePort;
}
