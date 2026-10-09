/**
 * 设置壳与页偏好 adapter 的纯逻辑断言（D5.1-S1 / DESK-SET-003 / DESK-SET-007）。
 *
 * 这里守三条不变量：
 *
 * 1. **分组骨架两端一致**——`SETTINGS_GROUPS` 的 id 集合与顺序是两宿主的公共
 *    约定，`?section=` 深链只能在登记分组内取锚。
 * 2. **adapter 是页面存储的唯一门面**——blob 形态整键读写；fields 形态只在
 *    文档内做字段级手术：重置只删登记的偏好键，草稿/结果/未知字段原样保留；
 *    损坏文档拒绝手术而不是猜着写。
 * 3. **字段登记表如实**——wired 项必须指到真实 owner；planned 项不得提前
 *    出现在设置页（登记表是审查对照面，不是渲染源）。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  SETTINGS_GROUP_IDS,
  SETTINGS_GROUPS,
  isSettingsGroupId,
  settingsGroupAnchorId,
} from '../src/settings/groups';
import {
  createPagePreferencesAdapter,
  resolvePagePreferenceFieldDefault,
  type PagePreferenceField,
  type PagePreferenceSource,
  type SettingsStorageLike,
} from '../src/settings/page-preferences';
import { SETTINGS_FIELD_REGISTRY } from '../src/settings/registry';

const createMemoryStorage = (): SettingsStorageLike & { dump(): Record<string, string> } => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
};

const BLOB_SOURCE: PagePreferenceSource = {
  pageId: 'details',
  title: '设定生成（/details）',
  pagePath: '/details',
  storageKey: 'test.details.preferences.v1',
  scope: 'blob',
  fields: [
    { key: 'imageSaveMode', label: '设定长图保存方式', kind: 'select', options: [
      { value: 'download', label: '一键下载' },
      { value: 'modal', label: '预览弹窗保存' },
    ] },
    { key: 'showDetails', label: '默认展开「设定说明」', kind: 'boolean' },
  ],
};

/** 模拟 Desktop 问卷草稿领域层提供的「首写合法文档」工厂。 */
const createTestDraftDocument = (): Record<string, unknown> => ({
  version: 1,
  answers: {},
  language: 'zh-CN',
});

const FIELDS_SOURCE: PagePreferenceSource = {
  pageId: 'details',
  title: '设定生成（/details）',
  pagePath: '/details',
  storageKey: 'test.desktop.details.draft.v1',
  scope: 'fields',
  fields: [
    { key: 'language', label: '生成语言', kind: 'readonly', notResettable: true },
    { key: 'imageSaveMode', label: '设定长图保存方式', kind: 'select', options: [
      { value: 'download', label: '一键下载' },
      { value: 'modal', label: '预览弹窗保存' },
    ] },
    { key: 'showDetails', label: '默认展开「设定说明」', kind: 'boolean' },
    { key: 'questionnaireSelections', label: '记住的问卷选择', kind: 'count' },
  ],
  createDocumentForFirstWrite: createTestDraftDocument,
};

/** 未提供首写工厂的 fields 源——空态写入必须 fail-closed。 */
const FIELDS_SOURCE_NO_FACTORY: PagePreferenceSource = {
  ...FIELDS_SOURCE,
  createDocumentForFirstWrite: undefined,
};

describe('settings groups', () => {
  it('keeps a stable unique group id set shared by both hosts', () => {
    expect(new Set(SETTINGS_GROUP_IDS).size).toBe(SETTINGS_GROUP_IDS.length);
    expect(SETTINGS_GROUP_IDS).toEqual([
      'account',
      'appearance',
      'generation',
      'online',
      'data',
      'advanced',
    ]);
    expect(SETTINGS_GROUPS.map((group) => group.label)).toHaveLength(SETTINGS_GROUP_IDS.length);
  });

  it('validates deep-link section values and builds anchors from group ids', () => {
    expect(isSettingsGroupId('appearance')).toBe(true);
    expect(isSettingsGroupId('appearance ')).toBe(false);
    expect(isSettingsGroupId('__proto__')).toBe(false);
    expect(isSettingsGroupId(undefined)).toBe(false);
    expect(settingsGroupAnchorId('generation')).toBe('settings-generation');
  });
});

describe('page preferences adapter — blob scope', () => {
  it('reports empty when the page has never written preferences', () => {
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, createMemoryStorage());
    expect(adapter.read()).toEqual({ status: 'empty' });
  });

  it('writes a single field into the page-owned blob and reads it back', () => {
    const storage = createMemoryStorage();
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, storage);

    expect(adapter.writeField('imageSaveMode', 'modal')).toBe(true);

    const read = adapter.read();
    expect(read.status).toBe('ready');
    if (read.status === 'ready') {
      expect(read.values.imageSaveMode).toBe('modal');
    }
    // 写的是页面自己的键——页面读到的必然是同一个值。
    expect(JSON.parse(storage.dump()[BLOB_SOURCE.storageKey])).toEqual({ imageSaveMode: 'modal' });
  });

  it('only exposes declared fields — unknown keys stay out of values but survive reset-free writes', () => {
    const storage = createMemoryStorage();
    storage.setItem(BLOB_SOURCE.storageKey, JSON.stringify({ imageSaveMode: 'modal', futureField: 42 }));
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, storage);

    const read = adapter.read();
    if (read.status !== 'ready') throw new Error('expected ready');
    expect(read.values).toEqual({ imageSaveMode: 'modal' });

    // 写另一个字段不得抹掉未登记键（向前兼容：未来版本新增字段不被本切片破坏）。
    expect(adapter.writeField('showDetails', false)).toBe(true);
    expect(JSON.parse(storage.dump()[BLOB_SOURCE.storageKey])).toEqual({
      imageSaveMode: 'modal',
      futureField: 42,
      showDetails: false,
    });
  });

  it('blob reset removes the whole key — the blob is all preferences, nothing else to spare', () => {
    const storage = createMemoryStorage();
    storage.setItem(BLOB_SOURCE.storageKey, JSON.stringify({ imageSaveMode: 'modal', futureField: 1 }));
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, storage);

    expect(adapter.reset()).toBe(true);
    expect(storage.getItem(BLOB_SOURCE.storageKey)).toBeNull();
  });

  it('rejects unregistered keys and out-of-contract values without touching storage', () => {
    const storage = createMemoryStorage();
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, storage);

    expect(() => adapter.writeField('answers', [])).toThrow(/未登记/);
    expect(() => adapter.writeField('imageSaveMode', 'teleport')).toThrow(/登记选项/);
    expect(() => adapter.writeField('showDetails', 'yes')).toThrow(/布尔/);
    expect(adapter.read()).toEqual({ status: 'empty' });
  });

  it('corrupted blob: read reports corrupted, writes refuse, reset still safe (whole key is preferences)', () => {
    const storage = createMemoryStorage();
    storage.setItem(BLOB_SOURCE.storageKey, '{not json');
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, storage);

    expect(adapter.read()).toEqual({ status: 'corrupted' });
    expect(adapter.writeField('showDetails', true)).toBe(false);
    expect(adapter.reset()).toBe(true);
    expect(storage.getItem(BLOB_SOURCE.storageKey)).toBeNull();
  });
});

describe('page preference field defaults', () => {
  it('resolves static and lazy defaults; missing default stays undefined', () => {
    const staticField: PagePreferenceField = {
      key: 'generationMode', label: 'x', kind: 'select', defaultValue: 'non-stream',
    };
    const lazyField: PagePreferenceField = {
      key: 'imageSaveMode', label: 'x', kind: 'select', defaultValue: () => 'modal',
    };
    const bareField: PagePreferenceField = { key: 'n', label: 'x', kind: 'count' };

    expect(resolvePagePreferenceFieldDefault(staticField)).toBe('non-stream');
    expect(resolvePagePreferenceFieldDefault(lazyField)).toBe('modal');
    expect(resolvePagePreferenceFieldDefault(bareField)).toBeUndefined();
  });
});

describe('page preferences adapter — fields scope', () => {
  const seedDraft = () =>
    JSON.stringify({
      version: 1,
      answers: { q1: '答' },
      output: { some: 'result' },
      language: 'zh-CN',
      imageSaveMode: 'download',
      showDetails: true,
      allowMultipleQuestionnaires: false,
      questionnaireSelections: ['a', 'b'],
      futureUnknown: { keep: 'me' },
    });

  it('reset removes only declared preference keys — draft, output and unknown fields survive', () => {
    const storage = createMemoryStorage();
    storage.setItem(FIELDS_SOURCE.storageKey, seedDraft());
    const adapter = createPagePreferencesAdapter(FIELDS_SOURCE, storage);

    expect(adapter.reset()).toBe(true);
    const doc = JSON.parse(storage.dump()[FIELDS_SOURCE.storageKey]);
    // 草稿字段与未知字段原样保留（DESK-SET-003）。
    expect(doc.answers).toEqual({ q1: '答' });
    expect(doc.output).toEqual({ some: 'result' });
    expect(doc.futureUnknown).toEqual({ keep: 'me' });
    // `language` 登记为 notResettable——草稿自有字段不属于「页偏好」。
    expect(doc.language).toBe('zh-CN');
    // 偏好键被删。
    for (const key of ['imageSaveMode', 'showDetails', 'questionnaireSelections']) {
      expect(doc).not.toHaveProperty(key);
    }
  });

  it('corrupted draft refuses surgery — protecting content we cannot parse', () => {
    const storage = createMemoryStorage();
    storage.setItem(FIELDS_SOURCE.storageKey, 'corrupted!');
    const adapter = createPagePreferencesAdapter(FIELDS_SOURCE, storage);

    expect(adapter.read()).toEqual({ status: 'corrupted' });
    expect(adapter.writeField('showDetails', true)).toBe(false);
    expect(adapter.reset()).toBe(false);
    // 文档原样还在——设置页不碰看不懂的草稿。
    expect(storage.getItem(FIELDS_SOURCE.storageKey)).toBe('corrupted!');
  });

  it('first write on empty storage builds the owner-supplied draft shell — not a bare preference key', () => {
    const storage = createMemoryStorage();
    const adapter = createPagePreferencesAdapter(FIELDS_SOURCE, storage);

    expect(adapter.read()).toEqual({ status: 'empty' });
    expect(adapter.writeField('imageSaveMode', 'modal')).toBe(true);

    const doc = JSON.parse(storage.dump()[FIELDS_SOURCE.storageKey]);
    // 草稿协议必填面来自领域工厂，偏好键落在其上——不是 {imageSaveMode} 裸对象。
    expect(doc).toEqual({
      version: 1,
      answers: {},
      language: 'zh-CN',
      imageSaveMode: 'modal',
    });
  });

  it('fields scope without a first-write factory fails closed on empty storage', () => {
    const storage = createMemoryStorage();
    const adapter = createPagePreferencesAdapter(FIELDS_SOURCE_NO_FACTORY, storage);

    expect(adapter.writeField('imageSaveMode', 'modal')).toBe(false);
    // 什么都没写——绝不伪造看不懂的宿主文档。
    expect(storage.getItem(FIELDS_SOURCE.storageKey)).toBeNull();
  });

  it('writeField preserves existing document content outside the written key', () => {
    const storage = createMemoryStorage();
    storage.setItem(FIELDS_SOURCE.storageKey, seedDraft());
    const adapter = createPagePreferencesAdapter(FIELDS_SOURCE, storage);

    expect(adapter.writeField('imageSaveMode', 'modal')).toBe(true);
    const doc = JSON.parse(storage.dump()[FIELDS_SOURCE.storageKey]);
    expect(doc.imageSaveMode).toBe('modal');
    expect(doc.answers).toEqual({ q1: '答' });
    expect(doc.language).toBe('zh-CN');
  });
});

describe('page preferences adapter — subscription', () => {
  it('notifies listeners on same-tab writes and resets', () => {
    const adapter = createPagePreferencesAdapter(BLOB_SOURCE, createMemoryStorage());
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe(listener);

    adapter.writeField('showDetails', true);
    adapter.reset();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    adapter.writeField('showDetails', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('settings field registry', () => {
  it('keeps unique field ids', () => {
    const ids = SETTINGS_FIELD_REGISTRY.map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every wired record points at a real owner and a registered group', () => {
    for (const record of SETTINGS_FIELD_REGISTRY) {
      expect(SETTINGS_GROUP_IDS).toContain(record.group);
      if (record.status === 'wired') {
        // wired 必须落到具体 owner 形态；config-json（S2 起是真实 owner）
        // 的 key 必须是点路径，device-storage 必须有真键。
        if (record.owner.kind === 'config-json') {
          expect(record.owner.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/u);
        }
        if (record.owner.kind === 'device-storage') {
          expect(record.owner.storageKey).toMatch(/^mahoshojo\./u);
        }
      }
    }
    // 登记表必须覆盖本切片三个真值源 + S2/N1 已交付的 config-json 字段。
    const wiredIds = SETTINGS_FIELD_REGISTRY.filter((r) => r.status === 'wired').map((r) => r.id);
    expect(wiredIds).toEqual(
      expect.arrayContaining([
        'appearance.colorMode',
        'appearance.motion',
        'appearance.resultAutoScroll',
        'generation.detailsPreferences',
        'generation.canshouPreferences',
        'announcements.checkPolicy',
        'externalLinks.confirmContentLinks',
        'desktop.escapeMenu.enabled',
        'publicLibraryCache.captureEnabled',
        'publicLibraryCache.maxBytes',
        'publicLibraryCache.whenFull',
      ]),
    );
    // K1 已交付 publicLibraryCache 三字段的真实消费者——登记表当前没有
    // 仍停在 planned 的 config-json 字段；新增字段须显式登记再落地。
    const plannedConfigKeys = SETTINGS_FIELD_REGISTRY.filter(
      (r) => r.status === 'planned' && r.owner.kind === 'config-json',
    ).map((r) => r.id);
    expect(plannedConfigKeys).toEqual([]);
  });

  it('page-preferences owners are machine-readable per host — real key and scope, not placeholders', () => {
    const record = (id: string) => {
      const found = SETTINGS_FIELD_REGISTRY.find((r) => r.id === id);
      if (!found || found.owner.kind !== 'page-preferences') {
        throw new Error(`${id} 未登记为 page-preferences owner`);
      }
      return found;
    };

    // Web blob 与 Desktop fields 是两种不同的持久化形态——登记表必须
    // 如实分宿主记录，宿主侧测试再钉它与真实装配逐字一致。
    expect(record('generation.detailsPreferences').owner).toEqual({
      kind: 'page-preferences',
      byHost: {
        web: { storageKey: 'mahoshojo.details.preferences.v1', scope: 'blob' },
        desktop: { storageKey: 'mahoshojo.desktop.details.draft.v1', scope: 'fields' },
      },
    });
    expect(record('generation.canshouPreferences').owner).toEqual({
      kind: 'page-preferences',
      byHost: {
        web: { storageKey: 'mahoshojo.canshou.preferences.v1', scope: 'blob' },
        desktop: { storageKey: 'mahoshojo.desktop.canshou.draft.v1', scope: 'fields' },
      },
    });

    // 结构不变量：byHost 只列出 hosts 声明的宿主，且每条都有非空真键。
    for (const r of SETTINGS_FIELD_REGISTRY) {
      if (r.owner.kind !== 'page-preferences') continue;
      const declared = r.hosts === 'shared' ? ['web', 'desktop'] : [r.hosts];
      expect(Object.keys(r.owner.byHost).sort()).toEqual([...declared].sort());
      for (const facts of Object.values(r.owner.byHost)) {
        // 历史/状态 owner 已使用此旧键；登记不能顺手重命名或创建第二 owner。
        if (r.id === 'generation.sublimationStatePreferences' && facts === r.owner.byHost.web) expect(facts?.storageKey).toBe('sublimation-history-state-preferences-v1');
        else expect(facts?.storageKey).toMatch(/^mahoshojo\./);
      }
    }
  });
});

describe('nested fields and required preference reset values', () => {
  const source: PagePreferenceSource = {
    ...FIELDS_SOURCE, fieldsContainer: 'payload',
    fields: [{ key: 'expanded', label: '展开', kind: 'boolean', resetValue: false }],
    createDocumentForFirstWrite: () => ({ version: 1, payload: { expanded: true, answers: {} } }),
  };
  it('patches one container and resets an explicit default without touching the envelope', () => {
    const storage = createMemoryStorage(); const original = { version: 1, updatedAt: 123, extension: [1], payload: { expanded: true, answers: { q: '答案' }, result: { text: '原文' } } };
    storage.setItem(source.storageKey, JSON.stringify(original)); const adapter = createPagePreferencesAdapter(source, storage);
    expect(adapter.reset()).toBe(true); expect(JSON.parse(storage.getItem(source.storageKey)!)).toEqual({ ...original, payload: { ...original.payload, expanded: false } });
  });
  it.each([{}, { payload: null }, { payload: [] }])('does not invent a missing/invalid container', (document) => {
    const storage = createMemoryStorage(); const raw = JSON.stringify(document); storage.setItem(source.storageKey, raw);
    const adapter = createPagePreferencesAdapter(source, storage); expect(adapter.read()).toEqual({ status: 'corrupted' }); expect(adapter.writeField('expanded', false)).toBe(false); expect(adapter.reset()).toBe(false); expect(storage.getItem(source.storageKey)).toBe(raw);
  });
  it('refuses an invalid owner reset default and validates the final document', () => {
    const storage = createMemoryStorage(); const raw = '{"payload":{"expanded":true}}'; storage.setItem(source.storageKey, raw);
    const adapter = createPagePreferencesAdapter({ ...source, fields: [{ ...source.fields[0], resetValue: 'bad' }] }, storage);
    expect(adapter.reset()).toBe(false); expect(storage.getItem(source.storageKey)).toBe(raw);
    const guarded = createPagePreferencesAdapter({ ...source, validateDocument: (value) => { if (!JSON.parse(value).payload.expanded) throw new Error('owner constraint'); } }, storage);
    expect(guarded.reset()).toBe(false); expect(storage.getItem(source.storageKey)).toBe(raw);
  });
});
