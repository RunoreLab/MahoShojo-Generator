import { GENERAL_SCENARIO_TEMPLATE_ID, inferCharacterKind } from '@mahoshojo/domain/data-cards';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema, nextLocalTimestamp, type LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { localLibraryRecordBytes } from '@mahoshojo/local-library/archive-export';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { exceedsUtf8ByteLimit } from '@mahoshojo/domain/data-card-size';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import type { MagicalGirlResultData } from '@mahoshojo/ui-web/character-result';
import type { CanshouDetails, GeneralCharacterCardData } from '@mahoshojo/ui-web/character-card';

/**
 * Desktop 本地角色编辑的业务规则（D3.2b-2）。
 *
 * 只依赖本地库契约与共源摘要：身份由正文摘要决定、标题不进摘要（`SPEC-local-library-web-landing-v1`
 * §2.3），因此“只改标题”与“改了正文”是两种不同的写入。模板转换、schema 校验、原生性与敏感词仍是 Web
 * 的能力，这里不复制。
 */

export type LocalCardType = LocalCardRecordV1['cardType'];

/** 可在本页编辑的类型。问卷与叙事历史在 Web 有专用编辑器，通用表单会误导用户以为已完整支持。 */
export const EDITABLE_CARD_TYPES: readonly LocalCardType[] = ['character', 'scenario'];

export const isEditableLocalCard = (record: LocalCardRecordV1): boolean =>
  EDITABLE_CARD_TYPES.includes(record.cardType) && isPlainObject(record.data);

/** 单个导入文件/粘贴文本的读取上限，与 native 单条 document 上限同一量级。 */
export const MAX_IMPORT_FILE_BYTES = MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES;

// UTF-8 字节早检实现已上移共享域层 `@mahoshojo/domain/data-card-size`（D5.1-P2-r2），
// 此处保留原导出供既有调用点/测试直接使用。
export { exceedsUtf8ByteLimit };

export interface CardDraft {
  /** 编辑既有本地记录时为该记录；导入时为 `null`。 */
  readonly original: LocalCardRecordV1 | null;
  readonly cardType: LocalCardType;
  readonly title: string;
  readonly data: Record<string, unknown>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (data: Record<string, unknown>, key: string): string | undefined => {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

export const defaultCardTitle = (data: Record<string, unknown>): string =>
  (stringField(data, 'codename') ?? stringField(data, 'name') ?? stringField(data, 'title') ?? '未命名数据卡').slice(0, 512);

/** 只做可解释的最小推断，用户可在界面上改。 */
export const inferEditableCardType = (data: Record<string, unknown>): LocalCardType =>
  data.templateId === GENERAL_SCENARIO_TEMPLATE_ID || (inferCharacterKind(data) === 'unknown' && Array.isArray(data.elements))
    ? 'scenario'
    : 'character';

export type ParsedImport =
  | { readonly ok: true; readonly draft: CardDraft }
  | { readonly ok: false; readonly error: string };

export const parseImportedCard = (text: string): ParsedImport => {
  // 字节上限先于解析：文件与粘贴共用同一入口，`file.size` 的早检只是少读一次大文件，
  // 解析前的这一次检查才是 bounded-input 的保证（schema 校验发生在 parse 之后，拦不住它）。
  if (exceedsUtf8ByteLimit(text, MAX_IMPORT_FILE_BYTES)) {
    return { ok: false, error: '内容超过单张数据卡的大小上限（4 MiB）。' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '内容不是合法的 JSON。' };
  }
  if (!isPlainObject(raw)) return { ok: false, error: '数据卡必须是一个 JSON 对象。' };
  if (raw.templateId === 'narrative-history') {
    return { ok: false, error: '叙事历史卡需要专用编辑器，本页暂不支持；可通过整库归档携带。' };
  }
  if (!SafeJsonValueSchema.safeParse(raw).success) {
    return { ok: false, error: '数据卡包含不支持的内容（例如嵌套过深、节点过多或保留字段）。' };
  }
  return { ok: true, draft: { original: null, cardType: inferEditableCardType(raw), title: defaultCardTitle(raw), data: raw } };
};

export const draftFromRecord = (record: LocalCardRecordV1): CardDraft => ({
  original: record,
  cardType: record.cardType,
  title: record.title,
  data: record.data as Record<string, unknown>,
});

export type SaveOutcome =
  | { readonly kind: 'unchanged' }
  /** 正文摘要不变，只有标题变化：原记录整卡替换。 */
  | { readonly kind: 'updated'; readonly record: LocalCardRecordV1 }
  /** 正文改变或新导入：以新摘要写入一条新记录。 */
  | { readonly kind: 'created'; readonly record: LocalCardRecordV1 }
  /** 同内容的活动记录已在本地库，未重复写入。 */
  | { readonly kind: 'exists'; readonly id: string }
  /** 同内容记录在回收站中；不隐式复活，交由用户显式恢复。 */
  | { readonly kind: 'in-recycle-bin'; readonly id: string }
  /** 组装后的 document 超出单条记录上限：envelope 让 4 MiB 原文可能装不进 4 MiB document。 */
  | { readonly kind: 'document-too-large' };

type SaveRepository = Pick<CardRepository, 'get' | 'put' | 'putIfAbsent'>;

/**
 * 保存一份草稿。
 *
 * - 正文摘要与原记录相同：标题没变则什么也不写；变了则以原记录为底整卡替换（保留 provenance、
 *   createdAt 与 cloudRef），时间戳单调抬升。
 * - 已有记录的 `cardType` 不可改：分类影响筛选、编辑入口与未来的类型消费逻辑，“重新分类”
 *   不是普通元数据编辑（冻结规格只定义“改标题直接更新、改正文另存新记录”）。草稿里的
 *   `cardType` 只在 `original === null`（导入、尚未首存）时生效。
 * - 正文改变或来自导入：以新摘要 `putIfAbsent` 写入 `unsigned` 新记录（编辑记为 `edited`，导入记为
 *   `imported`）。原记录不动——是否移入回收站由用户另行决定。正文中既有的签名字段原样保留、不在本机
 *   校验，因此 provenance 不继承原记录的签名判定。
 * - 写库前对最终 document 做字节预检：envelope（id/title/provenance/时间戳）会让接近 4 MiB
 *   的原文装不进 4 MiB 记录，此时返回 `document-too-large` 而不是落到泛化校验失败。
 */
export const saveCardDraft = async (
  repository: SaveRepository,
  draft: CardDraft,
  now: () => number = Date.now,
): Promise<SaveOutcome> => {
  const title = draft.title.trim() || '未命名数据卡';
  const { original } = draft;
  // 已有记录的类型只读；新导入草稿才允许选择类型。
  const cardType = original?.cardType ?? draft.cardType;
  const contentDigest = await digestLocalCardPayloadV1(draft.data);
  const id = deriveLocalDataCardIdV1(contentDigest);

  if (original !== null && original.id === id) {
    if (original.title === title && original.cardType === cardType) return { kind: 'unchanged' };
    const record = LocalCardRecordV1Schema.parse({
      ...original,
      title,
      cardType,
      updatedAt: nextLocalTimestamp(original.updatedAt, now),
    });
    if (localLibraryRecordBytes(record).byteLength > MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES) {
      return { kind: 'document-too-large' };
    }
    await repository.put(record);
    return { kind: 'updated', record };
  }

  const timestamp = new Date(now()).toISOString();
  const record = LocalCardRecordV1Schema.parse({
    id,
    schemaVersion: 1,
    storageLocation: 'local',
    cardType,
    title,
    data: draft.data,
    contentDigest,
    provenance: { kind: 'unsigned', execution: original === null ? 'imported' : 'edited' },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (localLibraryRecordBytes(record).byteLength > MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES) {
    return { kind: 'document-too-large' };
  }
  const outcome = await repository.putIfAbsent(record);
  if ('written' in outcome) return { kind: 'created', record };
  const existing = await repository.get(id);
  return existing?.deletedAt !== undefined ? { kind: 'in-recycle-bin', id } : { kind: 'exists', id };
};

/** 共源结果正文需要完整的五段结构；缺任何一段就不渲染预览，而不是让它在半截数据上抛错。 */
export const asMagicalGirlPreview = (draft: CardDraft): MagicalGirlResultData | null => {
  const { data } = draft;
  if (draft.cardType !== 'character' || inferCharacterKind(data) !== 'magical-girl') return null;
  if (typeof data.codename !== 'string') return null;
  const sections = ['appearance', 'magicConstruct', 'wonderlandRule', 'blooming', 'analysis'] as const;
  return sections.every((key) => isPlainObject(data[key])) ? (data as unknown as MagicalGirlResultData) : null;
};

/** 编辑器「角色卡预览」的判别 union——模板由正文特征决定，与 Web 角色管理同一判定函数。 */
export type CharacterCardPreview =
  | { readonly kind: 'magical-girl'; readonly data: MagicalGirlResultData }
  | { readonly kind: 'general'; readonly data: GeneralCharacterCardData }
  | { readonly kind: 'canshou'; readonly data: CanshouDetails };

/** `GeneralCharacterCardData` 的最小形状：名字与正文必填，其余字段宽松透传。 */
const GENERAL_REQUIRED_KEYS = ['name', 'content'] as const;

/** `CanshouDetails` 的全部必填字段——缺任何一段就不渲染整卡，与 magical-girl 同一口径。 */
const CANSHOU_REQUIRED_KEYS = [
  'name',
  'coreConcept',
  'coreEmotion',
  'evolutionStage',
  'appearance',
  'materialAndSkin',
  'featuresAndAppendages',
  'attackMethod',
  'specialAbility',
  'origin',
  'birthEnvironment',
  'researcherNotes',
] as const;

/**
 * 把草稿投影成可渲染的角色卡预览。情景卡与无法识别的数据返回 `null`——预览只表达
 * 「这段正文真的能渲染成一张卡」，残缺数据宁可不预览也不让组件在半截输入上抛错。
 */
export const asCharacterCardPreview = (draft: CardDraft): CharacterCardPreview | null => {
  if (draft.cardType !== 'character') return null;
  const kind = inferCharacterKind(draft.data);
  if (kind === 'general') {
    return GENERAL_REQUIRED_KEYS.every((key) => typeof draft.data[key] === 'string')
      ? { kind: 'general', data: draft.data as unknown as GeneralCharacterCardData }
      : null;
  }
  if (kind === 'canshou') {
    return CANSHOU_REQUIRED_KEYS.every((key) => typeof draft.data[key] === 'string')
      ? { kind: 'canshou', data: draft.data as unknown as CanshouDetails }
      : null;
  }
  const magical = asMagicalGirlPreview(draft);
  return magical === null ? null : { kind: 'magical-girl', data: magical };
};
