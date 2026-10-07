/**
 * `config.json` 域语义的契约测试（D5.1-S2，DESK-SET-004..007）。
 *
 * 钉住四条规格口径：
 *
 * 1. 缺文件语义由调用方处理，本模块只管「文本 → 生效值 + 诊断」；
 * 2. 非法值按字段各自的降级规则走——公告策略回默认、外链确认回 true
 *   （更保守），且都留下可定位诊断；
 * 3. 未登记键产生诊断但**不静默删除**——`serializeDesktopConfig` 写回时
 *    原样并入；
 * 4. JSON 语法错误、顶层非对象、version 非 1 是 fatal：全默认 + 不可作为
 *    编辑基底。
 */
import { describe, expect, it } from 'vitest';

import {
  DESKTOP_CONFIG_DEFAULTS,
  DESKTOP_CONFIG_EXAMPLE,
  DESKTOP_CONFIG_FILE_VERSION,
  parseDesktopConfigText,
  serializeDesktopConfig,
  type DesktopConfigDocumentExtras,
} from '../src/desktop-config';
import {
  DesktopConfigFileStateSchema,
  DesktopConfigReadResultSchema,
  DesktopConfigWriteRequestSchema,
} from '../src/desktop-ipc';

const diagPaths = (text: string) =>
  parseDesktopConfigText(text).diagnostics.map((diagnostic) => diagnostic.path);

describe('desktop config domain', () => {
  it('parses a minimal valid document and the shipped example', () => {
    const minimal = parseDesktopConfigText('{"version":1}');
    expect(minimal.fatal).toBe(false);
    expect(minimal.values).toEqual(DESKTOP_CONFIG_DEFAULTS);
    expect(minimal.diagnostics).toEqual([]);

    const example = parseDesktopConfigText(DESKTOP_CONFIG_EXAMPLE);
    expect(example.fatal).toBe(false);
    expect(example.values).toEqual(DESKTOP_CONFIG_DEFAULTS);
    expect(JSON.parse(DESKTOP_CONFIG_EXAMPLE).version).toBe(DESKTOP_CONFIG_FILE_VERSION);
  });

  it('accepts the registered fields when values are legal', () => {
    const parsed = parseDesktopConfigText(
      JSON.stringify({
        version: 1,
        announcements: { checkPolicy: 'manual' },
        externalLinks: { confirmContentLinks: false },
        desktop: { escapeMenu: { enabled: false } },
      }),
    );
    expect(parsed.fatal).toBe(false);
    expect(parsed.values).toEqual({
      announcementsCheckPolicy: 'manual',
      confirmContentLinks: false,
      escapeMenuEnabled: false,
    });
    expect(parsed.diagnostics).toEqual([]);
  });

  it('degrades invalid field values per-field with locatable diagnostics', () => {
    const parsed = parseDesktopConfigText(
      JSON.stringify({
        version: 1,
        announcements: { checkPolicy: 'sometimes' },
        externalLinks: { confirmContentLinks: 'no' },
        desktop: { escapeMenu: { enabled: 'yes' } },
      }),
    );
    expect(parsed.fatal).toBe(false);
    // 公告策略回默认（无害偏好）；外链确认回 true（更保守，DESK-SET-007）；
    // Esc 菜单开关回 true（默认启用，DESK-PARITY-007）。
    expect(parsed.values).toEqual(DESKTOP_CONFIG_DEFAULTS);
    expect(diagPaths(JSON.stringify({
      version: 1,
      announcements: { checkPolicy: 'sometimes' },
      externalLinks: { confirmContentLinks: 'no' },
      desktop: { escapeMenu: { enabled: 'yes' } },
    }))).toEqual([
      '$.announcements.checkPolicy',
      '$.externalLinks.confirmContentLinks',
      '$.desktop.escapeMenu.enabled',
    ]);
  });

  it('treats a non-object registered group as that group defaulted', () => {
    const parsed = parseDesktopConfigText(
      JSON.stringify({
        version: 1,
        announcements: 5,
        externalLinks: { confirmContentLinks: false },
        desktop: { escapeMenu: 'enabled' },
      }),
    );
    expect(parsed.fatal).toBe(false);
    expect(parsed.values.announcementsCheckPolicy).toBe('on-launch');
    expect(parsed.values.confirmContentLinks).toBe(false);
    // 子组不是对象 → 该子组字段整体按默认处理（不丢兄弟组里的已登记值）。
    expect(parsed.values.escapeMenuEnabled).toBe(true);
    expect(parsed.diagnostics.map((d) => d.path)).toEqual(['$.announcements', '$.desktop.escapeMenu']);
  });

  it('flags unregistered keys but preserves them on write-back', () => {
    const raw = JSON.stringify({
      version: 1,
      announcements: { checkPolicy: 'manual', futureKey: 1 },
      publicLibraryCache: { budgetMiB: 512 },
      desktop: { futureDesktopKey: 1, escapeMenu: { enabled: false, futureEscKey: 2 } },
    });
    const parsed = parseDesktopConfigText(raw);
    expect(parsed.fatal).toBe(false);
    expect(parsed.values.announcementsCheckPolicy).toBe('manual');
    // `desktop.escapeMenu.enabled` 自 D5.1-N1 起是已登记字段：被消费而不是被诊断。
    expect(parsed.values.escapeMenuEnabled).toBe(false);
    expect(parsed.diagnostics.map((d) => d.path).sort()).toEqual([
      '$.announcements.futureKey',
      '$.desktop.escapeMenu.futureEscKey',
      '$.desktop.futureDesktopKey',
      '$.publicLibraryCache',
    ]);

    // 写回：登记的字段更新，未登记键原样保留——UI 保存不得静默删除未知字段。
    const written = serializeDesktopConfig(
      { announcementsCheckPolicy: 'on-launch', confirmContentLinks: true, escapeMenuEnabled: true },
      parsed.extras,
    );
    const doc = JSON.parse(written) as Record<string, unknown>;
    expect(doc.announcements).toEqual({ checkPolicy: 'on-launch', futureKey: 1 });
    expect(doc.publicLibraryCache).toEqual({ budgetMiB: 512 });
    expect(doc.desktop).toEqual({
      futureDesktopKey: 1,
      escapeMenu: { enabled: true, futureEscKey: 2 },
    });
  });

  it('marks whole-file problems fatal with defaults', () => {
    for (const text of ['{not json', '[]', '42', 'null', '"x"', '{"version":2}', '{"other":1}']) {
      const parsed = parseDesktopConfigText(text);
      expect(parsed.fatal, text).toBe(true);
      expect(parsed.values, text).toEqual(DESKTOP_CONFIG_DEFAULTS);
      expect(parsed.diagnostics[0]?.path, text).toBe('$');
    }
  });

  it('serializes deterministically and round-trips', () => {
    const values = {
      announcementsCheckPolicy: 'manual' as const,
      confirmContentLinks: false,
      escapeMenuEnabled: false,
    };
    const extras: DesktopConfigDocumentExtras = {
      topLevel: { futureTop: { a: 1 } },
      announcements: {},
      externalLinks: { futureLink: 'x' },
      desktop: {},
      desktopEscapeMenu: { futureEscKey: 2 },
    };
    const text = serializeDesktopConfig(values, extras);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      version: 1,
      announcements: { checkPolicy: 'manual' },
      externalLinks: { confirmContentLinks: false, futureLink: 'x' },
      desktop: { escapeMenu: { enabled: false, futureEscKey: 2 } },
      futureTop: { a: 1 },
    });
    expect(parseDesktopConfigText(text).values).toEqual(values);
  });
});

describe('desktop config IPC envelope', () => {
  const revision = `sha256:${'a'.repeat(64)}`;

  it('accepts the four file states with a revision for present files', () => {
    for (const file of [
      { status: 'missing' },
      { status: 'ok', revision, content: '{"version":1}' },
      { status: 'oversized', revision, bytes: 999999 },
      { status: 'invalid-utf8', revision },
    ]) {
      expect(DesktopConfigFileStateSchema.safeParse(file).success, JSON.stringify(file)).toBe(true);
    }
    const result = DesktopConfigReadResultSchema.safeParse({
      path: '/cfg/config.json',
      directory: '/cfg',
      backupPresent: false,
      file: { status: 'missing' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed revisions and oversized write content', () => {
    expect(DesktopConfigFileStateSchema.safeParse({ status: 'ok', revision: 'abc', content: '{}' }).success).toBe(false);
    expect(
      DesktopConfigWriteRequestSchema.safeParse({ expectedRevision: null, content: 'x'.repeat(70 * 1024) }).success,
    ).toBe(false);
    expect(
      DesktopConfigWriteRequestSchema.safeParse({ expectedRevision: revision, content: '{"version":1}' }).success,
    ).toBe(true);
  });
});
