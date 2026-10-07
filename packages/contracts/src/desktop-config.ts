/**
 * Desktop 人工配置文件（`config.json`）的域语义（D5.1-S2，DESK-SET-004..007）。
 *
 * 这是「TypeScript schema 负责共同语义」的那一半：文件格式、字段登记、默认值、
 * 非法值降级与诊断定位都在这里；native 只检查字节有界、路径固定、revision 与
 * 原子替换（DESK-SET-005 的分工），不在 Rust 里复制这份领域实现。UI 与手工
 * 修改经同一个 `parseDesktopConfigText` 解析，不存在第二套判定。
 *
 * 首批字段只登记有真实消费者的键（DESK-SET-007）：
 *
 * - `announcements.checkPolicy`：公告检查策略，`'on-launch' | 'manual'`，
 *   默认 `'on-launch'`；非法值按默认处理并诊断（DESK-PARITY-003）。
 * - `externalLinks.confirmContentLinks`：内容外链打开前确认，boolean，
 *   默认 `true`；非法值按 `true`（更保守）处理并诊断（DESK-PARITY-003）。
 * - `desktop.escapeMenu.enabled`：Esc 快捷菜单开关，boolean，默认 `true`；
 *   非法值按 `true` 处理并诊断（D5.1-N1，DESK-PARITY-007）。
 * - `publicLibraryCache.captureEnabled` / `maxBytes` / `whenFull`：公开库
 *   持久缓存策略（D5.1-K1，DESK-CACHE-008）。默认捕获开启、预算 256 MiB、
 *   满额暂停。该组的降级不是逐字段回默认：任一字段无法校验即整组降级为
 *   「暂停捕获 + 暂停淘汰」（`publicCacheDegraded`），并留下可定位诊断。
 *
 * 未登记的键属于各自消费切片的字段，落地前出现在文件里会产生「未登记
 * 字段」诊断——文件仍可使用，未知键原样保留但不是有效配置。
 *
 * 安全边界（DESK-SET-006）：这里登记的只是无害展示偏好与本地资源策略。
 * 服务 origin、secret/header、CSP、IPC capability、Strict/多人资格与
 * 签名校验永远不进入这份文件。
 */

export const DESKTOP_CONFIG_FILE_VERSION = 1;

/** `announcements.checkPolicy` 的合法取值（公告 store 与设置页共用同一字面量）。 */
export type AnnouncementsCheckPolicy = 'on-launch' | 'manual';

/**
 * `publicLibraryCache.maxBytes` 的合法域（DESK-CACHE-008）。
 *
 * - 有限预算：字节为单位的正整数，最小 1 MiB、上限为 JSON 安全整数；
 * - `'unlimited'`：显式字符串，表示不设上限——`0`、负数、`null` 与其余
 *   字符串都是非法值，不是「无限」的别名。
 */
export const DESKTOP_PUBLIC_CACHE_MIN_BUDGET_BYTES = 1_048_576;
export const DESKTOP_PUBLIC_CACHE_DEFAULT_MAX_BYTES = 268_435_456;
export const DESKTOP_PUBLIC_CACHE_MAX_BUDGET_BYTES = Number.MAX_SAFE_INTEGER;
export type DesktopPublicCacheBudget = number | 'unlimited';

/** `publicLibraryCache.whenFull` 的合法取值。默认 `pause`；`evict-least-recently-used` 必须用户显式开启。 */
export type DesktopPublicCacheWhenFull = 'pause' | 'evict-least-recently-used';

export const isDesktopPublicCacheBudget = (value: unknown): value is DesktopPublicCacheBudget =>
  value === 'unlimited'
  || (typeof value === 'number'
    && Number.isInteger(value)
    && value >= DESKTOP_PUBLIC_CACHE_MIN_BUDGET_BYTES
    && value <= DESKTOP_PUBLIC_CACHE_MAX_BUDGET_BYTES);

export const isDesktopPublicCacheWhenFull = (
  value: unknown,
): value is DesktopPublicCacheWhenFull =>
  value === 'pause' || value === 'evict-least-recently-used';

/** 设置页可直接使用的取值视图（扁平、与文件键分离）。 */
export interface DesktopConfigValues {
  /** `announcements.checkPolicy` */
  readonly announcementsCheckPolicy: AnnouncementsCheckPolicy;
  /** `externalLinks.confirmContentLinks` */
  readonly confirmContentLinks: boolean;
  /** `desktop.escapeMenu.enabled` */
  readonly escapeMenuEnabled: boolean;
  /** `publicLibraryCache.captureEnabled` */
  readonly publicCacheCaptureEnabled: boolean;
  /** `publicLibraryCache.maxBytes`；`'unlimited'` = 显式不设上限 */
  readonly publicCacheMaxBytes: DesktopPublicCacheBudget;
  /** `publicLibraryCache.whenFull` */
  readonly publicCacheWhenFull: DesktopPublicCacheWhenFull;
}

export const DESKTOP_CONFIG_DEFAULTS: DesktopConfigValues = {
  announcementsCheckPolicy: 'on-launch',
  confirmContentLinks: true,
  escapeMenuEnabled: true,
  publicCacheCaptureEnabled: true,
  publicCacheMaxBytes: DESKTOP_PUBLIC_CACHE_DEFAULT_MAX_BYTES,
  publicCacheWhenFull: 'pause',
};

export interface DesktopConfigDiagnostic {
  /** 出错位置：`$.announcements.checkPolicy` 形态；整文件级问题用 `$`。 */
  readonly path: string;
  readonly message: string;
}

/**
 * 解析出但未登记的键，按出现位置原样保留。`serializeDesktopConfig` 写回时
 * 并入这些键——「UI 保存把未知字段静默删掉」等于毁损用户手改的文件
 * （DESK-SET-003/004 的同一口径）。
 */
export interface DesktopConfigDocumentExtras {
  readonly topLevel: Readonly<Record<string, unknown>>;
  readonly announcements: Readonly<Record<string, unknown>>;
  readonly externalLinks: Readonly<Record<string, unknown>>;
  /** `$.desktop` 下除 `escapeMenu` 外的未登记键。 */
  readonly desktop: Readonly<Record<string, unknown>>;
  /** `$.desktop.escapeMenu` 下除 `enabled` 外的未登记键。 */
  readonly desktopEscapeMenu: Readonly<Record<string, unknown>>;
  /** `$.publicLibraryCache` 下除三个登记字段外的未登记键。 */
  readonly publicLibraryCache: Readonly<Record<string, unknown>>;
}

export const DESKTOP_CONFIG_EMPTY_EXTRAS: DesktopConfigDocumentExtras = {
  topLevel: {},
  announcements: {},
  externalLinks: {},
  desktop: {},
  desktopEscapeMenu: {},
  publicLibraryCache: {},
};

export interface DesktopConfigParseResult {
  /** 各字段按降级规则归一后的生效值。 */
  readonly values: DesktopConfigValues;
  readonly diagnostics: readonly DesktopConfigDiagnostic[];
  /**
   * `true` = 文件整体不可作为编辑基底（JSON 语法错误、顶层不是对象或
   * version 非 1）：全部字段落回默认值，UI 不应在此基础上写出（只能显式
   * 恢复默认），原文靠 native `.bak` 与「不覆盖」规则保留。
   */
  readonly fatal: boolean;
  /**
   * `publicLibraryCache` 组存在但任一字段无法校验（或组本身不是对象）：
   * 生效值已降级为「暂停捕获 + 暂停淘汰」（DESK-CACHE-008）。
   * 与 `fatal` 分开报告——配置 UI 据此区分「用户关了缓存」与「字段坏了」。
   */
  readonly publicCacheDegraded: boolean;
  readonly extras: DesktopConfigDocumentExtras;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const REGISTERED_TOP_LEVEL_KEYS = new Set([
  'version',
  'announcements',
  'externalLinks',
  'desktop',
  'publicLibraryCache',
]);

const collectExtras = (
  group: unknown,
  registeredKeys: ReadonlySet<string>,
  basePath: string,
  diagnostics: DesktopConfigDiagnostic[],
): Record<string, unknown> => {
  const extras: Record<string, unknown> = {};
  if (!isPlainObject(group)) return extras;
  for (const key of Object.keys(group)) {
    if (registeredKeys.has(key)) continue;
    extras[key] = group[key];
    diagnostics.push({
      path: `${basePath}.${key}`,
      message: '未登记的字段；当前版本不消费，写回时原样保留',
    });
  }
  return extras;
};

export const parseDesktopConfigText = (text: string): DesktopConfigParseResult => {
  const diagnostics: DesktopConfigDiagnostic[] = [];
  const fatal = (message: string): DesktopConfigParseResult => ({
    values: DESKTOP_CONFIG_DEFAULTS,
    diagnostics: [...diagnostics, { path: '$', message }],
    fatal: true,
    // 整份文件不可读 ⇒ 缓存策略同样不可校验——按 DESK-CACHE-008 暂停捕获。
    publicCacheDegraded: true,
    extras: DESKTOP_CONFIG_EMPTY_EXTRAS,
  });

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return fatal(`不是合法的 JSON（${error instanceof Error ? error.message : '解析失败'}）`);
  }
  if (!isPlainObject(doc)) {
    return fatal('配置文件顶层必须是 JSON 对象');
  }
  if (doc.version !== DESKTOP_CONFIG_FILE_VERSION) {
    return fatal(
      doc.version === undefined
        ? `缺少 version 字段（当前格式要求 version: ${DESKTOP_CONFIG_FILE_VERSION}）`
        : `不支持的配置版本 ${JSON.stringify(doc.version)}（当前仅支持 version: ${DESKTOP_CONFIG_FILE_VERSION}）`,
    );
  }

  const extras: {
    topLevel: Record<string, unknown>;
    announcements: Record<string, unknown>;
    externalLinks: Record<string, unknown>;
    desktop: Record<string, unknown>;
    desktopEscapeMenu: Record<string, unknown>;
    publicLibraryCache: Record<string, unknown>;
  } = {
    topLevel: {},
    announcements: {},
    externalLinks: {},
    desktop: {},
    desktopEscapeMenu: {},
    publicLibraryCache: {},
  };
  for (const key of Object.keys(doc)) {
    if (REGISTERED_TOP_LEVEL_KEYS.has(key)) continue;
    extras.topLevel[key] = doc[key];
    diagnostics.push({
      path: `$.${key}`,
      message: '未登记的字段；当前版本不消费，写回时原样保留',
    });
  }

  let announcementsCheckPolicy: DesktopConfigValues['announcementsCheckPolicy'] =
    DESKTOP_CONFIG_DEFAULTS.announcementsCheckPolicy;
  if ('announcements' in doc) {
    if (!isPlainObject(doc.announcements)) {
      diagnostics.push({
        path: '$.announcements',
        message: '必须是对象；该组字段已全部按默认值处理',
      });
    } else {
      Object.assign(
        extras.announcements,
        collectExtras(doc.announcements, new Set(['checkPolicy']), '$.announcements', diagnostics),
      );
      const checkPolicy = doc.announcements.checkPolicy;
      if (checkPolicy !== undefined) {
        if (checkPolicy === 'on-launch' || checkPolicy === 'manual') {
          announcementsCheckPolicy = checkPolicy;
        } else {
          diagnostics.push({
            path: '$.announcements.checkPolicy',
            message: `非法值，按默认 ${DESKTOP_CONFIG_DEFAULTS.announcementsCheckPolicy} 处理`,
          });
        }
      }
    }
  }

  let confirmContentLinks = DESKTOP_CONFIG_DEFAULTS.confirmContentLinks;
  if ('externalLinks' in doc) {
    if (!isPlainObject(doc.externalLinks)) {
      diagnostics.push({
        path: '$.externalLinks',
        message: '必须是对象；该组字段已全部按默认值处理',
      });
    } else {
      Object.assign(
        extras.externalLinks,
        collectExtras(
          doc.externalLinks,
          new Set(['confirmContentLinks']),
          '$.externalLinks',
          diagnostics,
        ),
      );
      const confirm = doc.externalLinks.confirmContentLinks;
      if (confirm !== undefined) {
        if (typeof confirm === 'boolean') {
          confirmContentLinks = confirm;
        } else {
          // DESK-SET-007：非法值退回更保守的值——确认而不是直接打开。
          diagnostics.push({
            path: '$.externalLinks.confirmContentLinks',
            message: '非法值，按 true（更保守）处理',
          });
        }
      }
    }
  }

  let escapeMenuEnabled = DESKTOP_CONFIG_DEFAULTS.escapeMenuEnabled;
  if ('desktop' in doc) {
    if (!isPlainObject(doc.desktop)) {
      diagnostics.push({
        path: '$.desktop',
        message: '必须是对象；该组字段已全部按默认值处理',
      });
    } else {
      Object.assign(
        extras.desktop,
        collectExtras(doc.desktop, new Set(['escapeMenu']), '$.desktop', diagnostics),
      );
      const escapeMenu = doc.desktop.escapeMenu;
      if (escapeMenu !== undefined) {
        if (!isPlainObject(escapeMenu)) {
          diagnostics.push({
            path: '$.desktop.escapeMenu',
            message: '必须是对象；该组字段已全部按默认值处理',
          });
        } else {
          Object.assign(
            extras.desktopEscapeMenu,
            collectExtras(escapeMenu, new Set(['enabled']), '$.desktop.escapeMenu', diagnostics),
          );
          const enabled = escapeMenu.enabled;
          if (enabled !== undefined) {
            if (typeof enabled === 'boolean') {
              escapeMenuEnabled = enabled;
            } else {
              diagnostics.push({
                path: '$.desktop.escapeMenu.enabled',
                message: '非法值，按默认 true 处理',
              });
            }
          }
        }
      }
    }
  }

  // DESK-CACHE-008：该组不是「逐字段回默认」——任一字段无法校验（或组本身
  // 不是对象）就整组降级为「暂停捕获 + 暂停淘汰」。`values` 仍逐字段如实
  // 归一（非法值回默认），缓存消费者读到 `publicCacheDegraded` 时必须按
  // 暂停运行，而不是按这里的字段值运行。
  let publicCacheCaptureEnabled = DESKTOP_CONFIG_DEFAULTS.publicCacheCaptureEnabled;
  let publicCacheMaxBytes = DESKTOP_CONFIG_DEFAULTS.publicCacheMaxBytes;
  let publicCacheWhenFull = DESKTOP_CONFIG_DEFAULTS.publicCacheWhenFull;
  let publicCacheDegraded = false;
  if ('publicLibraryCache' in doc) {
    const markDegraded = (path: string, message: string): void => {
      diagnostics.push({ path, message });
      publicCacheDegraded = true;
    };
    if (!isPlainObject(doc.publicLibraryCache)) {
      markDegraded('$.publicLibraryCache', '必须是对象；缓存策略已按「暂停捕获、不淘汰」处理');
    } else {
      const group = doc.publicLibraryCache;
      Object.assign(
        extras.publicLibraryCache,
        collectExtras(
          group,
          new Set(['captureEnabled', 'maxBytes', 'whenFull']),
          '$.publicLibraryCache',
          diagnostics,
        ),
      );
      if (group.captureEnabled !== undefined) {
        if (typeof group.captureEnabled === 'boolean') {
          publicCacheCaptureEnabled = group.captureEnabled;
        } else {
          markDegraded(
            '$.publicLibraryCache.captureEnabled',
            '非法值；缓存策略已按「暂停捕获、不淘汰」处理',
          );
        }
      }
      if (group.maxBytes !== undefined) {
        if (isDesktopPublicCacheBudget(group.maxBytes)) {
          publicCacheMaxBytes = group.maxBytes;
        } else {
          markDegraded(
            '$.publicLibraryCache.maxBytes',
            `非法值（应为 >= ${DESKTOP_PUBLIC_CACHE_MIN_BUDGET_BYTES} 的整数或 "unlimited"）；缓存策略已按「暂停捕获、不淘汰」处理`,
          );
        }
      }
      if (group.whenFull !== undefined) {
        if (isDesktopPublicCacheWhenFull(group.whenFull)) {
          publicCacheWhenFull = group.whenFull;
        } else {
          markDegraded(
            '$.publicLibraryCache.whenFull',
            '非法值（"pause" | "evict-least-recently-used"）；缓存策略已按「暂停捕获、不淘汰」处理',
          );
        }
      }
    }
  }

  return {
    values: {
      announcementsCheckPolicy,
      confirmContentLinks,
      escapeMenuEnabled,
      publicCacheCaptureEnabled,
      publicCacheMaxBytes,
      publicCacheWhenFull,
    },
    diagnostics,
    fatal: false,
    publicCacheDegraded,
    extras,
  };
};

/**
 * 规范化写出：顶层 `version: 1` + 已登记组 + 未登记键原样保留。
 * 固定两段缩进与结尾换行——文件是给人看的，格式漂移本身就是一种噪声。
 */
export const serializeDesktopConfig = (
  values: DesktopConfigValues,
  extras?: DesktopConfigDocumentExtras,
): string =>
  `${JSON.stringify(
    {
      version: DESKTOP_CONFIG_FILE_VERSION,
      announcements: {
        ...extras?.announcements,
        checkPolicy: values.announcementsCheckPolicy,
      },
      externalLinks: {
        ...extras?.externalLinks,
        confirmContentLinks: values.confirmContentLinks,
      },
      desktop: {
        ...extras?.desktop,
        escapeMenu: {
          ...extras?.desktopEscapeMenu,
          enabled: values.escapeMenuEnabled,
        },
      },
      publicLibraryCache: {
        ...extras?.publicLibraryCache,
        captureEnabled: values.publicCacheCaptureEnabled,
        maxBytes: values.publicCacheMaxBytes,
        whenFull: values.publicCacheWhenFull,
      },
      ...extras?.topLevel,
    },
    null,
    2,
  )}\n`;

/** 与 `serializeDesktopConfig` 同一形态的示例文档（DESK-SET-004「同版例子」）。 */
export const DESKTOP_CONFIG_EXAMPLE: string = serializeDesktopConfig(DESKTOP_CONFIG_DEFAULTS);
