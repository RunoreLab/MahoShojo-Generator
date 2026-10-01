import { z } from './zod';

import {
  LocalCardContentDigestSchema,
  LocalCardIdSchema,
  LocalCardRecordV1Schema,
  LocalCardSchemaVersionSchema,
  type LocalCardRecordV1,
  Sha256ChecksumSchema,
} from './record';
import {
  LOCAL_WEB_PACKAGE_SCHEMA_VERSION,
  LocalWebPackageRecordV1Schema,
  type LocalWebPackageRecordV1,
} from './web-package-record';

/**
 * Portable archive 的 manifest 契约（V2）。
 *
 * ## V1 为什么被直接替换而不是保留
 *
 * V1 只有 schema 与它自己的测试，**零 producer、零 consumer**：没有任何代码产出或消费过
 * 一个 V1 归档。因此不存在"既有 archive 兼容性"需要保护——保留一个永远没人产出的格式
 * 只是负债。（ADR 第 8 条那条约束针对的是摘要算法的下沉，不是这个。）
 *
 * V1 的 `assets` 命名空间同理被移除：它设想的是卡片内嵌图片，而 `DESK-054` 已确认当前四种
 * 数据卡 schema **均无图片字段**（唯一的图片字段 `questionnaire.logoUrl` 是远程 URL 字符串）。
 * 为一个不存在的消费者保留命名空间，会让后来者以为它有人在用。
 *
 * ## Web 包条目为什么是独立 schema（`DESK-059b`）
 *
 * V1 的 asset 条目有两条 `superRefine`：`checksum === contentDigest`，且 path 必须由
 * `contentDigest` 推导。这两条对 Web 包**全部不成立**（`DESK-063`：manifest 摘要 ≠ ZIP 字节
 * 摘要）。复用它会让每一条真实 Web 包都被自己的 `superRefine` 拒绝，而症状表现为
 * "所有包都导入失败"——一个极难定位的失败。
 *
 * 因此 Web 包条目显式分开命名两个摘要：
 *
 * - `contentDigest`：manifest 摘要，构成领域身份，等于记录的 `contentDigest`；
 * - `archiveDigest`：ZIP 字节的摘要，只充当存储地址与完整性校验。
 *
 * 两者 **MUST NOT** 被要求相等，也 **MUST NOT** 被断言不等——前者会破坏整个身份模型，
 * 后者会把一个合法的巧合变成拒绝理由。
 *
 * ## 归档内布局
 *
 * ```text
 * manifest.json                     本文件
 * cards/<stem>.json                 一条 LocalCardRecordV1 的序列化
 * web-packages/<stem>.json          一条 LocalWebPackageRecordV1 的序列化
 * archives/<64hex>.zip              Web 包的原始 ZIP 字节
 * ```
 *
 * 路径形状由 schema 校验，具体 stem 由**导出侧**挑选（见 [`localLibraryArchiveStem`]）；
 * manifest 的 `superRefine` 强制全归档路径唯一，因此导出侧的挑选不可能撞车。
 */

export const LOCAL_LIBRARY_ARCHIVE_FORMAT = 'mahoshojo-local-library' as const;

/**
 * 归档格式版本。
 *
 * 从 2 起步而不是从 1 递增：V1 从未被任何代码产出过，**不存在**已存在于野外的 V1 归档。
 * 让第一个真实格式占用 1 会让将来的读取器误以为需要处理一个它从未见过的历史版本。
 */
export const LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION = 2 as const;

export const MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES = 100_000 as const;

const IsoTimestampSchema = z.string().datetime({ offset: true });
const ArchiveByteLengthSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const WindowsReservedFileStemSchema = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u;

/**
 * 一段归档内路径的文件名主干。
 *
 * 约束比一般文件系统更紧：归档可能被解到 Windows 上，因此保留设备名（`con`、`lpt1`…）
 * 与结尾的点都必须拒绝——它们在 Windows 上会指向意料之外的位置，或者根本无法被创建。
 * 大写也被拒绝：跨大小写不敏感的文件系统上 `Cards/A.json` 与 `cards/a.json` 会撞车。
 */
const SAFE_STEM = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

const isPortableStem = (stem: string): boolean =>
  SAFE_STEM.test(stem) && !stem.endsWith('.') && !WindowsReservedFileStemSchema.test(stem);

const cardJsonPathSchema = z
  .string()
  .regex(/^cards\/[a-z0-9][a-z0-9._-]{0,127}\.json$/u, 'must be a lowercase safe cards/*.json path')
  .superRefine((path, context) => {
    if (!isPortableStem(path.slice('cards/'.length, -'.json'.length))) {
      context.addIssue({ code: 'custom', message: 'card path must be portable across supported filesystems' });
    }
  });

const webPackageJsonPathSchema = z
  .string()
  .regex(
    /^web-packages\/[a-z0-9][a-z0-9._-]{0,127}\.json$/u,
    'must be a lowercase safe web-packages/*.json path',
  )
  .superRefine((path, context) => {
    if (!isPortableStem(path.slice('web-packages/'.length, -'.json'.length))) {
      context.addIssue({
        code: 'custom',
        message: 'web package path must be portable across supported filesystems',
      });
    }
  });

/**
 * Web 包 ZIP 的归档内路径：`<64 位小写 hex>.zip`。
 *
 * **必须**由 `archiveDigest` 推导——这条让"路径指向的字节"无法与"清单声称的摘要"脱节。
 * 它与卡片条目形成对照：卡片的 path 可以任意（内容身份由 `contentDigest` 承担），而归档
 * 字节的身份**就是**它的地址。
 */
const webPackageArchivePathSchema = z
  .string()
  .regex(/^archives\/[0-9a-f]{64}\.zip$/u, 'must be a lowercase content-addressed archives/*.zip path');

export const LocalLibraryArchiveCardEntryV2Schema = z
  .object({
    cardId: LocalCardIdSchema,
    path: cardJsonPathSchema,
    /** 卡片内容的领域身份（canonical payload 的摘要）。**不是** path 处文件的摘要。 */
    contentDigest: LocalCardContentDigestSchema,
    /** SHA-256 over the exact UTF-8 bytes stored at `path`。 */
    checksum: Sha256ChecksumSchema,
    byteLength: ArchiveByteLengthSchema,
  })
  .strict();
export type LocalLibraryArchiveCardEntryV2 = z.infer<typeof LocalLibraryArchiveCardEntryV2Schema>;

/**
 * Web 包条目。
 *
 * 三个摘要各司其职，MUST NOT 互相替代：
 *
 * - `contentDigest`：manifest 摘要 = 领域身份 = 包 id 的派生来源（`DESK-063`）；
 * - `archiveDigest`：ZIP 字节摘要 = 存储地址 = 完整性校验，且**必须**由 `archivePath` 推导；
 * - `checksum`：`path` 处那条 JSON 记录自身的字节摘要。
 *
 * 前两个必然不同——ZIP 里除了 manifest 还有文件。把它们合成一个 `digest` 是 D2.1 之前
 * 差点犯的错，此处由 `DESK-059b` 明确禁止。
 */
export const LocalLibraryArchiveWebPackageEntryV2Schema = z
  .object({
    /** 包的本地 id，形状与卡片 id 同构（`LocalCardIdSchema`），但由 `deriveLocalWebPackageId` 派生。 */
    packageId: LocalCardIdSchema,
    path: webPackageJsonPathSchema,
    /** manifest 摘要，构成领域身份。必须等于记录 JSON 里的 `contentDigest`。 */
    contentDigest: LocalCardContentDigestSchema,
    /** SHA-256 over the exact UTF-8 bytes stored at `path`。 */
    checksum: Sha256ChecksumSchema,
    byteLength: ArchiveByteLengthSchema,
    /** 原始 ZIP 字节在归档内的位置。 */
    archivePath: webPackageArchivePathSchema,
    /** ZIP 字节自身的摘要。**与 contentDigest 必然不同**（DESK-063）。 */
    archiveDigest: Sha256ChecksumSchema,
    archiveByteLength: ArchiveByteLengthSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    const expectedPath = `archives/${entry.archiveDigest.slice('sha256:'.length)}.zip`;
    if (entry.archivePath !== expectedPath) {
      context.addIssue({
        code: 'custom',
        path: ['archivePath'],
        message: 'archivePath must be derived from archiveDigest',
      });
    }
    // contentDigest 与 archiveDigest 之间的关系**刻意不断言**。
    // 加 `must differ` 会把一个合法的巧合变成拒绝理由（虽然当前 ZIP 头使它不可能发生），
    // 加 `must equal` 会直接破坏身份模型。见 DESK-059b。
  });
export type LocalLibraryArchiveWebPackageEntryV2 = z.infer<
  typeof LocalLibraryArchiveWebPackageEntryV2Schema
>;

export const LocalLibraryArchiveManifestV2Schema = z
  .object({
    format: z.literal(LOCAL_LIBRARY_ARCHIVE_FORMAT),
    formatVersion: z.literal(LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION),
    /**
     * 两个 schema 版本**分开**记录。
     *
     * 它们独立演进（本地卡记录与 Web 包记录是两种实体，共用身份与时间戳不变量但各有载荷
     * 形状，见 `web-package-record.ts`）。合成一个数字会在其中一方升级时给出错误信息——
     * 读取器无法知道它能读懂哪一种。
     */
    cardSchemaVersion: LocalCardSchemaVersionSchema,
    webPackageSchemaVersion: z.literal(LOCAL_WEB_PACKAGE_SCHEMA_VERSION),
    exportedAt: IsoTimestampSchema,
    cardCount: z.number().int().nonnegative().max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
    webPackageCount: z.number().int().nonnegative().max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
    cards: z.array(LocalLibraryArchiveCardEntryV2Schema).max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
    webPackages: z
      .array(LocalLibraryArchiveWebPackageEntryV2Schema)
      .max(MAX_LOCAL_LIBRARY_ARCHIVE_ENTRIES),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.cardCount !== manifest.cards.length) {
      context.addIssue({ code: 'custom', path: ['cardCount'], message: 'cardCount must match cards length' });
    }
    if (manifest.webPackageCount !== manifest.webPackages.length) {
      context.addIssue({
        code: 'custom',
        path: ['webPackageCount'],
        message: 'webPackageCount must match webPackages length',
      });
    }

    const cardIds = new Set<string>();
    const packageIds = new Set<string>();
    // 路径唯一性覆盖**整个归档**，不只是每个命名空间内部：`cards/a.json` 与
    // `web-packages/a.json` 的 stem 相同是允许的（不同目录），但两个包写成同一个
    // `web-packages/a.json` 就是导出侧的 bug，而它会让解包时后者静默覆盖前者。
    const paths = new Set<string>();
    const claimPath = (path: string, pathName: (string | number)[]): void => {
      if (paths.has(path)) {
        context.addIssue({ code: 'custom', path: pathName, message: 'archive path must be unique' });
      }
      paths.add(path);
    };

    manifest.cards.forEach((entry, index) => {
      if (cardIds.has(entry.cardId)) {
        context.addIssue({ code: 'custom', path: ['cards', index, 'cardId'], message: 'cardId must be unique' });
      }
      cardIds.add(entry.cardId);
      claimPath(entry.path, ['cards', index, 'path']);
    });
    manifest.webPackages.forEach((entry, index) => {
      if (packageIds.has(entry.packageId)) {
        context.addIssue({
          code: 'custom',
          path: ['webPackages', index, 'packageId'],
          message: 'packageId must be unique',
        });
      }
      packageIds.add(entry.packageId);
      claimPath(entry.path, ['webPackages', index, 'path']);
      claimPath(entry.archivePath, ['webPackages', index, 'archivePath']);
    });
  });
export type LocalLibraryArchiveManifestV2 = z.infer<typeof LocalLibraryArchiveManifestV2Schema>;

/**
 * 归档内固定的文件名。
 *
 * 单点定义：导出侧写它、导入侧读它。把它内联进两处会是一次必然的漂移，而漂移的后果是
 * "导出的归档在另一端找不到清单"。
 */
export const LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH = 'manifest.json' as const;

/**
 * 为一个记录 id 挑一段安全的归档路径主干。
 *
 * schema 只**校验**路径形状，具体 stem 由导出侧挑选，因此挑选规则需要单点实现：两侧各自
 * 拼字符串会在"什么算安全"上产生分歧，而分歧的后果是导出成功、导入失败。
 *
 * 规则：小写化 → 非 `[a-z0-9._-]` 换成 `-` → 折叠重复 `-` → 去掉首尾的 `.` 与 `-` →
 * 截断到 96 字符。截断后为空则退回 `entry`。
 *
 * **不做**的事：不追加唯一后缀。唯一性由 manifest 的 `superRefine` 强制，因此导出侧只需在
 * 撞名时换一个名字，而不必在这里引入哈希或计数器——那会让路径在同一份库的不同导出之间
 * 变得不稳定，而稳定性对"两次导出应当产出相同归档"这件事很重要。
 */
export const localLibraryArchiveStem = (seed: string): string => {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[._-]+/u, '')
    .replace(/[._-]+$/u, '')
    .slice(0, 96)
    // 截断可能把结尾落在 `-` 或 `.` 上，重新修一次。
    .replace(/[._-]+$/u, '');
  if (normalized.length === 0) return 'entry';
  // Windows 保留设备名。`con` 归一化后**恰好**仍是 `con`——只做字符替换与首尾修整的规则会
  // 把它原样吐出，于是 `cards/con.json` 在 Windows 上根本无法创建。用户看到的症状会是
  // "自己刚导出的归档打不开"，而原因藏在派生规则里。
  //
  // 修法必须是**前缀**而不是后缀：保留名判据是 `^con(?:\.|$)`，只看开头。`con.txt` 追加
  // `-` 得到 `con.txt-`，仍然以 `con.` 开头，仍然是设备名。前缀一个 `x` 则一定躲开，
  // 且保留剩余部分便于排查。
  return WindowsReservedFileStemSchema.test(normalized) ? `x-${normalized}` : normalized;
};

/**
 * 卡片记录在归档内应当使用的路径。
 *
 * `stem` 由 [`localLibraryArchiveStem`] 从 id 派生。导出侧仍**必须**检查最终 manifest 是否
 * 通过校验：两个 id 可能派生出同一个 stem（例如 `A/B` 与 `a-b`），那属于导出侧的职责。
 */
export const localLibraryArchiveCardPath = (stem: string): string => `cards/${stem}.json`;

export const localLibraryArchiveWebPackagePath = (stem: string): string =>
  `web-packages/${stem}.json`;

/** ZIP 字节的归档路径**必须**由其摘要推导，因此这个函数不接受 stem。 */
export const localLibraryArchiveWebPackageArchivePath = (archiveDigest: string): string =>
  `archives/${archiveDigest.slice('sha256:'.length)}.zip`;

/**
 * 严格 UTF-8 解码。
 *
 * 用 `TextDecoder` 的 fatal 模式，而不是默认的替换模式：后者会用 U+FFFD 静默替换非法序列，
 * 于是**校验通过的记录与用户导出的字节不再对应**——而本模块的全部价值就在于"清单里的
 * checksum 与文件里的字节一致"。这里静默降级会让 `checksum` 变成一个无法复现的承诺。
 */
const decodeUtf8Strict = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/**
 * 解析归档内的一条记录 JSON。
 *
 * 刻意把"解码 + 校验"合成一步，并**只**返回校验后的记录：记录 schema 自带防御性副本
 * （`data` / `manifest` 都经过一次深拷贝）。把原文与校验结果作为两样东西返回，只会留下
 * "某处用了原文"的可能——而那正好绕过整条完整性链条。
 *
 * 摘要**不在**这里校验。checksum 需要对着 `crypto.subtle` 算，本模块是纯契约层、同时运行在
 * Node 与浏览器测试里，把异步摘要算子塞进来会让它无法在纯同步的 schema 测试中被覆盖。
 * 因此摘要校验由导入侧（D2.3c）在拿到字节后立即做，且**必须**在做别的任何事之前做。
 */
export const parseLocalLibraryArchiveCard = (bytes: Uint8Array): LocalCardRecordV1 =>
  LocalCardRecordV1Schema.parse(parseJsonStrict(decodeUtf8Strict(bytes)));

export const parseLocalLibraryArchiveWebPackage = (bytes: Uint8Array): LocalWebPackageRecordV1 =>
  LocalWebPackageRecordV1Schema.parse(parseJsonStrict(decodeUtf8Strict(bytes)));

/**
 * `JSON.parse` 的失败也转成 zod 风格的失败。
 *
 * `JSON.parse` 抛的是 `SyntaxError`，而 schema 抛的是 `ZodError`。让调用方同时处理两种错误
 * 类型，会让它不得不用 try/catch 兜住一类本该和校验失败走同一条路的错误——而导入侧的逻辑
 * 是"逐条 try，失败就记进报告"，两种异常都掉进同一个 catch，所以差别只体现在**别处**：
 * 任何单独 catch `ZodError` 做分类统计的代码都会漏掉语法错误那一半。
 *
 * 错误路径上返回的值本身是无效输入，交给 schema 立刻失败即可。
 */
const parseJsonStrict = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

export type LocalLibraryArchiveManifest = LocalLibraryArchiveManifestV2;
export const LocalLibraryArchiveManifestSchema = LocalLibraryArchiveManifestV2Schema;
