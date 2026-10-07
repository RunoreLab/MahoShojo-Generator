/**
 * 设置页「空草稿键首写」的跨层回归（D5.1-S1-r1 / DESK-SET-003）。
 *
 * Desktop 页偏好嵌在草稿文档里（fields 形态）。空键上的第一次字段写入
 * 必须经问卷草稿领域层工厂建立合法空壳——这里用**真实的 settings 装配**
 * （`DESKTOP_*_PREFERENCES`，含真实草稿键与 `createDocumentForFirstWrite`）
 * 写出文档，再交给**真实的会话层**解析，守三条不变量：
 *
 * 1. 产物通过 `parseDraft`——不触发 `isDraftBlocked` 的数据保护；
 * 2. 产物被 `isResidueDraft` 判为残余——不含用户内容，页面静默应用，
 *    不弹「恢复草稿」门禁（pendingRestore 为 false）；
 * 3. 写入的偏好字段随草稿恢复进入会话 draft——设置页修改与页面生效同值。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createPagePreferencesAdapter,
  SETTINGS_FIELD_REGISTRY,
} from '@mahoshojo/ui-web/settings';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { DetailsSession } from '../src/features/details/session';
import { CanshouSession } from '../src/features/canshou/session';
import {
  createEmptyQuestionnaireDraftDocument,
  QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE,
} from '../src/features/questionnaire/session';
import {
  DESKTOP_CANSHOU_PREFERENCES,
  DESKTOP_DETAILS_PREFERENCES,
} from '../src/app/settings-page-preferences';

const createSharedStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    readRaw: (key: string) => map.get(key) ?? null,
  };
};

const repository = { putIfAbsent: vi.fn(async () => ({ written: true as const })) } as unknown as CardRepository;
const initialDraft = { answers: {}, language: QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE };

describe('settings first-write draft document', () => {
  it('the domain factory emits the draft protocol required surface only', () => {
    expect(createEmptyQuestionnaireDraftDocument()).toEqual({
      version: 1,
      answers: {},
      language: 'zh-CN',
    });
  });

  it('details: first write on an empty draft key restores through DetailsSession without gating', () => {
    const storage = createSharedStorage();
    const adapter = createPagePreferencesAdapter(DESKTOP_DETAILS_PREFERENCES, storage);

    expect(adapter.writeField('imageSaveMode', 'modal')).toBe(true);
    const raw = storage.readRaw(DESKTOP_DETAILS_PREFERENCES.storageKey);
    expect(JSON.parse(raw!)).toEqual({
      version: 1,
      answers: {},
      language: 'zh-CN',
      imageSaveMode: 'modal',
    });

    // 真实草稿键 + 真实会话：设置页写出的文档必须被当作合法残余草稿，
    // 而不是损坏数据（blocked）或待确认草稿（pendingRestore）。
    const session = new DetailsSession({ storage, repository, initialDraft });
    expect(session.isDraftBlocked()).toBe(false);
    expect(session.getSnapshot().pendingRestore).toBe(false);
    // 残余草稿静默应用——设置页写入的偏好照常进入页面 draft。
    expect(session.getSnapshot().draft).toMatchObject({
      answers: {},
      language: 'zh-CN',
      imageSaveMode: 'modal',
    });
  });

  it('canshou: first write on an empty draft key restores through CanshouSession without gating', () => {
    const storage = createSharedStorage();
    const adapter = createPagePreferencesAdapter(DESKTOP_CANSHOU_PREFERENCES, storage);

    expect(adapter.writeField('showDetails', true)).toBe(true);

    const session = new CanshouSession({ storage, repository, initialDraft });
    expect(session.isDraftBlocked()).toBe(false);
    expect(session.getSnapshot().pendingRestore).toBe(false);
    expect(session.getSnapshot().draft).toMatchObject({
      answers: {},
      language: 'zh-CN',
      showDetails: true,
    });
  });

  it('registry desktop owner facts match the real host assembly key-for-key', () => {
    // 登记表是审查对照面：byHost.desktop 必须逐字等于真实装配，
    // 否则「机器可读」只是另一份会漂移的文档（D5.1-S1-r1）。
    const ownerOf = (id: string) => {
      const record = SETTINGS_FIELD_REGISTRY.find((r) => r.id === id);
      if (record?.owner.kind !== 'page-preferences') throw new Error(`${id} owner 缺失`);
      return record.owner.byHost.desktop;
    };

    expect(ownerOf('generation.detailsPreferences')).toEqual({
      storageKey: DESKTOP_DETAILS_PREFERENCES.storageKey,
      scope: DESKTOP_DETAILS_PREFERENCES.scope,
    });
    expect(ownerOf('generation.canshouPreferences')).toEqual({
      storageKey: DESKTOP_CANSHOU_PREFERENCES.storageKey,
      scope: DESKTOP_CANSHOU_PREFERENCES.scope,
    });
  });

  it('later field edits preserve answers/output — the page is never downgraded to preference-only data', () => {
    const storage = createSharedStorage();
    storage.setItem(DESKTOP_DETAILS_PREFERENCES.storageKey, JSON.stringify({
      version: 1,
      answers: { belief: '守护' },
      language: 'zh-CN',
      output: { mode: 'direct-local', phase: 'cancelled', rawText: '中断正文', card: null },
      imageSaveMode: 'download',
    }));
    const adapter = createPagePreferencesAdapter(DESKTOP_DETAILS_PREFERENCES, storage);

    expect(adapter.writeField('jsonSaveMode', 'text')).toBe(true);
    const doc = JSON.parse(storage.readRaw(DESKTOP_DETAILS_PREFERENCES.storageKey)!);
    expect(doc.answers).toEqual({ belief: '守护' });
    expect(doc.output).toMatchObject({ phase: 'cancelled', rawText: '中断正文' });
    expect(doc.jsonSaveMode).toBe('text');
    expect(doc.imageSaveMode).toBe('download');

    // 含真实用户内容的草稿必须走 pending 门禁——不是残余，不能被静默覆盖。
    const session = new DetailsSession({ storage, repository, initialDraft });
    expect(session.isDraftBlocked()).toBe(false);
    expect(session.getSnapshot().pendingRestore).toBe(true);
  });
});
