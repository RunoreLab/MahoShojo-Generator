// 角色管理页的浏览器内草稿（D5.1-P2-r5，与 Web `page-draft` 同一产品语义）。
//
// 与 Web 同一 key、版本与 30 天 TTL——恢复的是「页面 scratch」而不是本地库记录
// （本地库另有 native 持久化）。Desktop 的 payload 形状与 Web 不同（多
// `originalId`/`title`/`cardType`），normalize 只接受本端写出的形状，陌生/损坏
// 内容按无草稿降级并清掉。
//
// 注意：编辑器里 `draft.original` 是 `LocalCardRecordV1` 全量记录——草稿只记
// `originalId`，恢复时再经 `repository.get` 回取；记录已被删除/移回收站时降级
// 为「无原记录的导入草稿」，绝不把陈旧副本当成本地库事实。

import {
  clearPageDraft,
  readPageDraft,
  writePageDraft,
  type StoredPageDraft,
} from '@mahoshojo/ui-web/client';

import type { LocalCardType } from './editor';

export const DESKTOP_CHARACTER_MANAGER_DRAFT_KEY = 'mahoshojo.character-manager.page-draft.v1';
const DESKTOP_CHARACTER_MANAGER_DRAFT_VERSION = 1;
const DESKTOP_CHARACTER_MANAGER_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredDesktopCardDraft {
  readonly cardType: LocalCardType;
  readonly title: string;
  readonly data: Record<string, unknown>;
  /** 若草稿源自本地库记录：该记录 id（恢复时经 repository 回取）。 */
  readonly originalId: string | null;
  /** 名称替换等「对比修改前正文」的基线快照；无则不可对比。 */
  readonly originalData: Record<string, unknown> | null;
}

export interface DesktopCharacterManagerDraftState {
  readonly pastedJson: string;
  readonly draft: StoredDesktopCardDraft | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeCardType = (value: unknown): LocalCardType =>
  value === 'scenario' ? 'scenario' : 'character';

const normalizeStoredDraft = (value: unknown): StoredDesktopCardDraft | null => {
  if (!isPlainObject(value) || !isPlainObject(value.data)) return null;
  return {
    cardType: normalizeCardType(value.cardType),
    title: typeof value.title === 'string' ? value.title : '未命名数据卡',
    data: value.data,
    originalId: typeof value.originalId === 'string' && value.originalId !== '' ? value.originalId : null,
    originalData: isPlainObject(value.originalData) ? value.originalData : null,
  };
};

export const normalizeDesktopDraftPayload = (raw: unknown): DesktopCharacterManagerDraftState | null => {
  if (!isPlainObject(raw)) return null;
  const pastedJson = typeof raw.pastedJson === 'string' ? raw.pastedJson : '';
  const draft = normalizeStoredDraft(raw.draft);
  if (draft === null && pastedJson.trim() === '') return null;
  return { pastedJson, draft };
};

export type StoredDesktopCharacterManagerDraft = StoredPageDraft<DesktopCharacterManagerDraftState>;

/** 读取仍有效的页面草稿；损坏/版本不符/过期返回 `null` 并顺手清掉。 */
export const readDesktopCharacterManagerDraft = (): StoredDesktopCharacterManagerDraft | null => {
  const stored = readPageDraft<unknown>(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY, {
    version: DESKTOP_CHARACTER_MANAGER_DRAFT_VERSION,
    ttlMs: DESKTOP_CHARACTER_MANAGER_DRAFT_TTL_MS,
  });
  if (stored === null) return null;
  const payload = normalizeDesktopDraftPayload(stored.payload);
  if (payload === null) {
    clearPageDraft(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY);
    return null;
  }
  return { ...stored, payload };
};

export const writeDesktopCharacterManagerDraft = (
  state: DesktopCharacterManagerDraftState,
): StoredPageDraft<DesktopCharacterManagerDraftState> | null =>
  writePageDraft(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY, state, {
    version: DESKTOP_CHARACTER_MANAGER_DRAFT_VERSION,
  });

export const clearDesktopCharacterManagerDraft = (): void =>
  clearPageDraft(DESKTOP_CHARACTER_MANAGER_DRAFT_KEY);
