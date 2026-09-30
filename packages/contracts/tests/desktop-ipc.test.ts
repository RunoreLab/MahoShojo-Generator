import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_SECRET_REF_PATTERN,
  DesktopSecretRefSchema,
  DesktopSecretStoreErrorSchema,
  MAX_DESKTOP_SECRET_REF_LENGTH,
  MAX_DESKTOP_SECRET_VALUE_BYTES,
  isDesktopSecretRef,
  MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES,
  MAX_DESKTOP_LOCAL_CARD_PAGE_SIZE,
  DesktopLocalCardIndexSchema,
  DesktopLocalCardCursorSchema,
  DesktopLocalCardTypeSchema,
  DesktopListLocalCardsRequestSchema,
  DesktopSaveLocalCardRequestSchema,
  DesktopStoreErrorCodeSchema,
} from '../src/desktop-ipc';

interface SecretRefFixture {
  validRefs: string[];
  invalidRefs: string[];
  maxRefLength: number;
  maxValueBytes: number;
}

/**
 * 这份 fixture 同时被 Rust 侧在编译期 `include_str!` 读取，是 DESK-033 的最小实例：
 * 两侧对同一条 secret 引用必须给出相同的接受/拒绝结论。
 */
const fixture: SecretRefFixture = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', 'fixtures', 'desktop-secret-refs.json'),
    'utf8',
  ),
) as SecretRefFixture;

describe('DesktopSecretRef', () => {
  it('mirrors the shared fixture limits', () => {
    expect(fixture.maxRefLength).toBe(MAX_DESKTOP_SECRET_REF_LENGTH);
    expect(fixture.maxValueBytes).toBe(MAX_DESKTOP_SECRET_VALUE_BYTES);
  });

  it('accepts every reference the fixture marks valid', () => {
    expect(fixture.validRefs.length).toBeGreaterThan(0);
    for (const ref of fixture.validRefs) {
      expect(isDesktopSecretRef(ref), `${JSON.stringify(ref)} must be accepted`).toBe(true);
      expect(DesktopSecretRefSchema.safeParse(ref).success).toBe(true);
    }
  });

  it('rejects every reference the fixture marks invalid', () => {
    expect(fixture.invalidRefs.length).toBeGreaterThan(0);
    for (const ref of fixture.invalidRefs) {
      expect(isDesktopSecretRef(ref), `${JSON.stringify(ref)} must be rejected`).toBe(false);
      expect(DesktopSecretRefSchema.safeParse(ref).success).toBe(false);
    }
  });

  it('keeps the length ceiling authoritative for both valid and invalid inputs', () => {
    const atLimit = 'a'.repeat(MAX_DESKTOP_SECRET_REF_LENGTH);
    const overLimit = 'a'.repeat(MAX_DESKTOP_SECRET_REF_LENGTH + 1);

    expect(DesktopSecretRefSchema.safeParse(atLimit).success).toBe(true);
    expect(DesktopSecretRefSchema.safeParse(overLimit).success).toBe(false);
    expect(isDesktopSecretRef(overLimit)).toBe(false);
  });

  it('never admits whitespace, path separators, control characters or non-ASCII', () => {
    // 引用会直接成为操作系统凭据存储的目标名，因此字符集必须是最小可辩护的子集。
    expect(DESKTOP_SECRET_REF_PATTERN.test(' ')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('/')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('\\')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('\n')).toBe(false);
    expect(DESKTOP_SECRET_REF_PATTERN.test('é')).toBe(false);
  });
});

describe('DesktopSecretStoreError', () => {
  it('projects a stable, non-secret error shape', () => {
    const parsed = DesktopSecretStoreErrorSchema.parse({
      code: 'secret-store-unavailable',
      message: 'operating system credential store is unavailable',
    });
    expect(parsed.code).toBe('secret-store-unavailable');

    expect(
      DesktopSecretStoreErrorSchema.safeParse({ code: 'unknown-code', message: 'x' }).success,
    ).toBe(false);
    expect(
      DesktopSecretStoreErrorSchema.safeParse({ code: 'secret-store-failure', message: 'x', extra: 1 })
        .success,
    ).toBe(false);
  });
});

interface LocalCardFixture {
  timestampCases: { name: string; why: string; id: string; updatedAt: string }[];
  limits: { maxDocumentBytes: number; maxPageSize: number };
  errorCodes: string[];
  cardTypes: string[];
  validIndex: unknown;
  tombstonedIndex: unknown;
  cursor: unknown;
  cases: { name: string; index: unknown; document: string; expectReject?: boolean }[];
}

/**
 * 本地卡 fixture 同样由 Rust 在编译期 `include_str!` 读取（见
 * `apps/desktop/src-tauri/src/local_card_contract_tests.rs`）。两侧断言的是各自的常量与
 * fixture 的具体取值相等，而不是各自内联一份期望值——否则"同步改了"会静默通过。
 */
const readLocalCardFixture = (): LocalCardFixture =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'fixtures', 'desktop-local-cards.json'), 'utf8'),
  ) as LocalCardFixture;

describe('Desktop 本地卡 IPC 契约', () => {
  const fixture = readLocalCardFixture();

  it('上限与 native 侧常量一致', () => {
    expect(MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES).toBe(fixture.limits.maxDocumentBytes);
    expect(MAX_DESKTOP_LOCAL_CARD_PAGE_SIZE).toBe(fixture.limits.maxPageSize);
  });

  it('错误码集合与 native 侧一致且顺序稳定', () => {
    expect(DesktopStoreErrorCodeSchema.options).toEqual(fixture.errorCodes);
  });

  it('卡类型与线上数据卡类型一致', () => {
    expect(DesktopLocalCardTypeSchema.options).toEqual(fixture.cardTypes);
  });

  it('接受 fixture 中的有效索引与 tombstone 索引', () => {
    expect(DesktopLocalCardIndexSchema.parse(fixture.validIndex)).toEqual(fixture.validIndex);
    expect(DesktopLocalCardIndexSchema.parse(fixture.tombstonedIndex)).toEqual(
      fixture.tombstonedIndex,
    );
    expect(DesktopLocalCardCursorSchema.parse(fixture.cursor)).toEqual(fixture.cursor);
  });

  it('不接受未知字段、非法卡类型与越界页大小', () => {
    expect(() => DesktopLocalCardIndexSchema.parse({ ...(fixture.validIndex as object), extra: 1 })).toThrow();
    expect(() =>
      DesktopListLocalCardsRequestSchema.parse({ limit: MAX_DESKTOP_LOCAL_CARD_PAGE_SIZE + 1 }),
    ).toThrow();
    expect(() => DesktopListLocalCardsRequestSchema.parse({ limit: 0 })).toThrow();
  });

  it('分页请求的缺省值是"排除 tombstone 且不筛选类型"', () => {
    const parsed = DesktopListLocalCardsRequestSchema.parse({ limit: 10 });
    expect(parsed.includeDeleted).toBe(false);
    expect(parsed.cardTypes).toEqual([]);
    expect(parsed.cursor).toBeUndefined();
  });

  it('fixture 里的 document 至少有一条含孤立代理项，且本包不做 JSON 解析', () => {
    // 契约只搬运文本。孤立代理项能否被 native 接受由 native 侧的 RawValue 决定，
    // 这里断言的只是"文本原样通过契约、不被 zod 改写"。
    const surrogate = fixture.cases.find((item) => item.document.includes('\\ud800'));
    expect(surrogate, 'fixture 必须覆盖孤立代理项载荷').toBeDefined();
    const request = DesktopSaveLocalCardRequestSchema.parse({
      document: surrogate?.document,
      index: surrogate?.index,
    });
    expect(request.document).toBe(surrogate?.document);
    expect(request.document).toContain('\\ud800');
  });

  it('带 UTC offset 的时间戳是契约允许的输入，而不是被拒或被改写', () => {
    // 契约允许任意 offset，native 必须按"时刻"而不是"文本"排序。把这里改成拒绝等于收窄
    // 可表示域——那需要走显式新版本。
    const fixtureWithOffsets = readLocalCardFixture();
    expect(fixtureWithOffsets.timestampCases.length).toBeGreaterThanOrEqual(3);

    for (const testCase of fixtureWithOffsets.timestampCases) {
      const parsed = DesktopLocalCardIndexSchema.parse({
        id: testCase.id,
        cardType: 'character',
        updatedAt: testCase.updatedAt,
        contentDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      // 逐字节保留：native 侧自行解析出排序键，本包不改写表示形式。
      expect(parsed.updatedAt).toBe(testCase.updatedAt);
    }
  });

  it('游标携带排序键，使它与存储层的比较口径一致', () => {
    expect(DesktopLocalCardCursorSchema.parse(fixture.cursor)).toEqual(fixture.cursor);
    // 缺省排序键必须被接受：首屏游标不带它。
    expect(
      DesktopLocalCardCursorSchema.parse({ updatedAt: fixture.cursor.updatedAt, id: fixture.cursor.id }),
    ).toMatchObject({ updatedAtSort: 0 });
  });
});
