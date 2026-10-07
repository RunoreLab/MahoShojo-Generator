import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as desktopIpc from '../src/desktop-ipc';
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
  MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES,
  DesktopBase64BytesSchema,
  DesktopBlobErrorCodeSchema,
  DesktopBlobWriteOutcomeSchema,
  DesktopSaveWebPackageRequestSchema,
  DesktopReadWebPackageArchiveRequestSchema,
  DesktopWebPackageIndexSchema,
  DesktopWebPackageTransitionRequestSchema,
  DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS,
  DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS,
  DesktopLocalLibraryAuditErrorSchema,
  DesktopLocalLibraryAuditFindingSchema,
  DesktopLocalLibraryAuditReportSchema,
  DesktopLocalLibraryGcErrorSchema,
  DesktopLocalLibraryGcReportSchema,
  DESKTOP_WEBPKG_INSTANCE_ID_HEADER,
  DESKTOP_WEBPKG_INSTANCE_URL_PREFIX,
  DESKTOP_WEBPKG_RESOURCE_HOST,
  DESKTOP_WEBPKG_RESOURCE_OFFSET_HEADER,
  DESKTOP_WEBPKG_RESOURCE_PATH_HEADER,
  DESKTOP_WEBPKG_URI_SCHEME,
  DESKTOP_WEBPKG_WEBVIEW_LABEL_PREFIX,
  DESKTOP_WEBPKG_WINDOWS_RESOURCE_HOST,
  DesktopAppendWebPackageResourceResponseSchema,
  DesktopBeginWebPackageInstanceRequestSchema,
  DesktopBeginWebPackageInstanceResponseSchema,
  DesktopOpenWebPackageInstanceRequestSchema,
  DesktopOpenWebPackageInstanceResponseSchema,
  DesktopWebPackageInstanceErrorCodeSchema,
  DesktopWebPackageInstanceErrorSchema,
  DesktopWebPackageInstanceIdSchema,
  DesktopWebPackageInstanceWebviewLabelSchema,
  MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES,
  MAX_DESKTOP_WEBPKG_INSTANCE_FILES,
  MAX_DESKTOP_WEBPKG_INSTANCE_TOTAL_BYTES,
  MAX_DESKTOP_WEBPKG_RESPONSE_BYTES,
  MAX_DESKTOP_WEBPKG_LIVE_BYTES,
  MAX_DESKTOP_WEBPKG_LIVE_INSTANCES,
  MAX_DESKTOP_WEBPKG_TITLE_LENGTH,
} from '../src/desktop-ipc';
import { WebPackageMediaTypeSchema, WebPackagePathSchema } from '../src/web-package';

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
  cursor: { updatedAtSort: number; updatedAt: string; id: string };
  cases: { name: string; index: unknown; document: string; expectReject?: boolean }[];
}

/**
 * 本地卡 fixture 同样由 Rust 在编译期 `include_str!` 读取（见
 * `apps/desktop/src-tauri/src/local_card_contract_tests.rs`）。两侧断言的是各自的常量与
 * fixture 的具体取值相等，而不是各自内联一份期望值——否则"同步改了"会静默通过。
 */
const readFixture = <T>(): T =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'fixtures', 'desktop-local-cards.json'), 'utf8'),
  ) as T;

const readLocalCardFixture = (): LocalCardFixture => readFixture<LocalCardFixture>();

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

interface BlobFixture {
  blobErrorCodes: string[];
  blobWriteOutcomes: string[];
  maxPackageArchiveBytes: number;
  webPackageIndex: unknown;
  webPackageIdentity: { $case: string; id: string; contentDigest: string };
  blobArchive: { $case: string; b64: string; len: number };
  readArchiveRequest: { $case: string; contentDigest: string };
}

/**
 * blob 与 Web 包 fixture 同样由 Rust 在编译期 `include_str!` 读取。
 *
 * 这里刻意**不**只断言 `b64` 是字符串：那份载荷的语义是"它解出来必须是一个 ZIP"。
 * 曾经出现过声明 4 字节却实际解出 5 字节的 fixture——两侧如果只比较字符串就会一起通过，
 * 直到用户导入时才炸。因此这里断言解码后的魔数与长度。
 */
const readBlobFixture = (): BlobFixture => readFixture<BlobFixture>();

describe('Desktop blob 与 Web 包 IPC 契约', () => {
  const fixture = readBlobFixture();

  it('上限与 native 侧常量一致', () => {
    expect(MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES).toBe(fixture.maxPackageArchiveBytes);
  });

  it('blob 错误码与写入结果集合与 native 侧一致且顺序稳定', () => {
    expect(DesktopBlobErrorCodeSchema.options).toEqual(fixture.blobErrorCodes);
    expect(DesktopBlobWriteOutcomeSchema.options).toEqual(fixture.blobWriteOutcomes);
  });

  it('base64 载荷的声明长度与实际解码长度一致，且解出 ZIP 魔数', () => {
    // 剔除 fixture 的说明字段：契约是 strict 的，它只是给人看的注释。
    const { $case: _case, ...payload } = fixture.blobArchive;
    expect(_case).toEqual(expect.any(String));

    const parsed = DesktopBase64BytesSchema.parse(payload);
    const bytes = Buffer.from(parsed.b64, 'base64');
    // 长度对不上却照样通过的话，失败点会被推到解包器里，离真正原因很远。
    expect(bytes.byteLength, 'base64 载荷长度必须与声明一致').toBe(parsed.len);
    // 载荷的语义是 ZIP：本地文件头魔数 PK\x03\x04。
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('base64 信封接受空字节序列——"空 archive 非法"是 ZIP 校验的职责', () => {
    // 传输信封顺带断言"非空"会让 toBase64Bytes(new Uint8Array([])) 产出自己的 schema 都拒绝的载荷。
    expect(DesktopBase64BytesSchema.parse({ b64: '', len: 0 })).toEqual({ b64: '', len: 0 });
  });

  it('不接受未知字段与越界长度', () => {
    expect(() => DesktopBase64BytesSchema.parse({ b64: 'UEsDBA==', len: 4, extra: 1 })).toThrow();
    expect(() =>
      DesktopBase64BytesSchema.parse({
        b64: 'UEsDBA==',
        len: MAX_DESKTOP_LOCAL_PACKAGE_ARCHIVE_BYTES + 1,
      }),
    ).toThrow();
  });

  it('接受 fixture 中的 Web 包索引与 tombstone 索引', () => {
    expect(DesktopWebPackageIndexSchema.parse(fixture.webPackageIndex)).toEqual(fixture.webPackageIndex);
    const tombstoned = {
      ...(fixture.webPackageIndex as object),
      deletedAt: '2026-09-30T13:00:00.000Z',
    };
    expect(DesktopWebPackageIndexSchema.parse(tombstoned)).toEqual(tombstoned);
  });

  it('读取归档的请求以 manifest 摘要为键，不接受包 id 形状', () => {
    // manifest 摘要是 `sha256:…`，包 id 是 `wp_…`。把两者混用会让真实读取路径必然落空。
    const { $case: _requestCase, ...request } = fixture.readArchiveRequest;
    expect(_requestCase).toEqual(expect.any(String));
    expect(DesktopReadWebPackageArchiveRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      DesktopReadWebPackageArchiveRequestSchema.parse({
        ...request,
        id: fixture.webPackageIdentity.id,
      }),
    ).toThrow();
  });

  it('读取归档的响应方向没有 schema，因为它是 raw 字节', () => {
    // 该命令返回 `tauri::ipc::Response`，渲染层拿到 `ArrayBuffer`。base64 信封曾让每个 Web 包
    // 的读取都多付 33% 体积与一次解码峰值，而 D2.3 导出对每个包都要读一遍字节。
    //
    // 因此这里断言的是"契约里**没有**这个响应 schema"：留着它会让后来者以为响应仍是 JSON
    // 信封，而两侧各自的单测都会绿（各自 mock 了对方的形状），直到真实 IPC 才炸。
    const surface = Object.keys(desktopIpc);
    expect(surface).not.toContain('DesktopReadWebPackageArchiveResponseSchema');
    // 写入方向仍在用 {b64, len}：单个包的量级没有到需要 raw 请求体的程度。
    expect(surface).toContain('DesktopBase64BytesSchema');
    // fixture 也必须没有这一段：两侧的 Rust 契约测试都 `include_str!` 同一份 fixture，留下一个
    // 没人读的键会让"契约包与实现同源"这件事变得无法验证（DESK-033）。
    expect(fixture).not.toHaveProperty('readArchiveResponse');
    // 请求侧的 fixture 仍在被断言（此前它没有任何读者）。
    const { $case: _requestCase, ...readRequest } = fixture.readArchiveRequest;
    expect(_requestCase).toEqual(expect.any(String));
    expect(DesktopReadWebPackageArchiveRequestSchema.parse(readRequest)).toEqual(readRequest);
  });

  it('canonical identity：包 id 与内容摘要在 fixture 中成对出现', () => {
    // 派生规则由 TS 单点实现（@mahoshojo/local-library 的 deriveLocalWebPackageId），
    // Web 与 Desktop 共用；native 只做 UNIQUE 存储约束而不重算。因此这条断言的是
    // "契约包里的 id 与摘要是同一个身份"，而不是在这里复算派生。
    const { $case: _case, ...identity } = fixture.webPackageIdentity;
    expect(_case).toEqual(expect.any(String));
    expect(DesktopWebPackageIndexSchema.parse(fixture.webPackageIndex).id).toBe(identity.id);
    expect(
      DesktopWebPackageIndexSchema.parse({
        ...(fixture.webPackageIndex as object),
        id: identity.id,
        contentDigest: identity.contentDigest,
      }),
    ).toMatchObject({ id: identity.id, contentDigest: identity.contentDigest });
    // id 必须是 wp_ 形式，摘要必须是 sha256: 形式——两者不可互换。
    expect(identity.id).toMatch(/^wp_[0-9a-f]{32}$/u);
    expect(identity.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('保存 Web 包必须带上 archive，缺字节的请求在契约层就被拒', () => {
    // 契约层缺字节会一路走到 native 才失败；这里拒掉可以让失败更早、更明确。
    const base = {
      document: '{}',
      index: fixture.webPackageIndex,
      now: '2026-09-30T12:00:00.000Z',
    };
    expect(() => DesktopSaveWebPackageRequestSchema.parse(base)).toThrow();
    expect(() =>
      DesktopSaveWebPackageRequestSchema.parse({ ...base, archive: fixture.blobArchive }),
    ).toThrow();
    const { $case: _case, ...archive } = fixture.blobArchive;
    expect(_case).toEqual(expect.any(String));
    const parsed = DesktopSaveWebPackageRequestSchema.parse({ ...base, archive });
    expect(parsed.archive).toEqual(archive);
  });

  it('删除/恢复 Web 包的请求只需要完整 document 与索引列，不需要 archive', () => {
    // 状态转移不产生新字节；要求 archive 会让"恢复一个包"也必须先把 ZIP 读回内存。
    const request = DesktopWebPackageTransitionRequestSchema.parse({
      document: '{}',
      index: fixture.webPackageIndex,
    });
    expect(Object.keys(request).sort()).toEqual(['document', 'index']);
  });
});

/** fixture 的 `maintenance` 段。D2.2 的审计与 GC 契约都在这里。 */
interface MaintenanceSection {
  $comment?: string;
  auditKinds: string[];
  auditDamageKinds: string[];
  auditErrorCodes: string[];
  gcErrorCodes: string[];
  gcReport: Record<string, unknown> & { $case?: string };
  auditReport: Record<string, unknown> & { $case?: string };
  auditFindingReferenceFileMissing: Record<string, unknown> & { $case?: string };
  auditFindingBytesMismatchEqualLength: Record<string, unknown> & { $case?: string };
  auditFindingBytesMismatchTruncated: Record<string, unknown> & { $case?: string };
  auditFindingUnreferencedMetadata: Record<string, unknown> & { $case?: string };
  auditFindingOrphanFile: Record<string, unknown> & { $case?: string };
  auditFindingRecordWithoutReference: Record<string, unknown> & { $case?: string };
  auditFindingForeignKeyViolation: Record<string, unknown> & { $case?: string };
}

interface MaintenanceFixture {
  maintenance: MaintenanceSection;
}

const readMaintenanceFixture = (): MaintenanceFixture => readFixture<MaintenanceFixture>();

/** 剔除 fixture 的人读注释：契约是 strict 的，注释字段不是契约的一部分。 */
const withoutCase = <T extends Record<string, unknown>>(value: T): Omit<T, '$case'> => {
  const { $case: _case, ...rest } = value;
  expect(_case).toEqual(expect.any(String));
  return rest;
};

describe('Desktop 本地库维护 IPC 契约（D2.2）', () => {
  const fixture = readMaintenanceFixture().maintenance;
  expect(fixture.$comment).toEqual(expect.any(String));

  it('桶集合与 native 侧一致且顺序稳定', () => {
    expect([...DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS]).toEqual(fixture.auditKinds);
  });

  it('「用户可见损坏」是桶的真子集', () => {
    expect([...DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS]).toEqual(fixture.auditDamageKinds);
    for (const kind of DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS) {
      expect(DESKTOP_LOCAL_LIBRARY_AUDIT_KINDS).toContain(kind);
    }
    // 孤儿文件与无引用 metadata 是崩溃窗口产物或 purge 后的回收候选：用户不会因此
    // 少看到任何包。把它们标成损坏会让真正要处理的问题被稀释。
    expect(DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS).not.toContain('orphan-file');
    expect(DESKTOP_LOCAL_LIBRARY_AUDIT_DAMAGE_KINDS).not.toContain('unreferenced-metadata');
  });

  it('审计错误码与 native 侧一致', () => {
    expect(DesktopLocalLibraryAuditErrorSchema.shape.code.options).toEqual(
      fixture.auditErrorCodes,
    );
  });

  it('接受 fixture 中的每一个桶，并保留 lengthMatches 这一区分', () => {
    const cases = [
      fixture.auditFindingReferenceFileMissing,
      fixture.auditFindingBytesMismatchEqualLength,
      fixture.auditFindingBytesMismatchTruncated,
      fixture.auditFindingUnreferencedMetadata,
      fixture.auditFindingOrphanFile,
      fixture.auditFindingRecordWithoutReference,
      fixture.auditFindingForeignKeyViolation,
    ];
    for (const value of cases) {
      const parsed = DesktopLocalLibraryAuditFindingSchema.parse(withoutCase(value));
      expect(parsed.kind).toBe(value['kind']);
    }

    // 等长但内容不同 vs 被截断：两者用户症状相同、成因不同，必须能被 UI 区分。
    // 判别联合的收窄靠 `kind`，因此先按 kind 过滤再读字段——直接读 `lengthMatches`
    // 只能在类型层面就报错，那正是这个 schema 用 `discriminatedUnion` 的原因。
    const mismatch = DesktopLocalLibraryAuditFindingSchema.parse(
      withoutCase(fixture.auditFindingBytesMismatchEqualLength),
    );
    const truncated = DesktopLocalLibraryAuditFindingSchema.parse(
      withoutCase(fixture.auditFindingBytesMismatchTruncated),
    );
    expect(mismatch.kind).toBe('reference-bytes-mismatch');
    expect(truncated.kind).toBe('reference-bytes-mismatch');
    if (mismatch.kind !== 'reference-bytes-mismatch' || truncated.kind !== 'reference-bytes-mismatch') {
      throw new Error('两个 fixture 都必须声明 reference-bytes-mismatch');
    }
    expect(mismatch.lengthMatches).toBe(true);
    expect(truncated.lengthMatches).toBe(false);
    expect(mismatch.expectedByteLength).toBe(truncated.expectedByteLength);
    expect(mismatch.actualByteLength).not.toBe(truncated.actualByteLength);
  });

  it('桶由 kind 判别：把一个桶的字段用在另一个桶上必须失败', () => {
    // 只检查 kind 而不检查字段的 schema 会让 `{kind: 'orphan-file', byteLength}` 被当作
    // `reference-file-missing` 接受，于是报告在 UI 上显示成"文件缺失"而实际是孤儿文件。
    expect(() =>
      DesktopLocalLibraryAuditFindingSchema.parse({
        kind: 'orphan-file',
        byteLength: 10,
        packageId: 'wp_0123456789abcdef0123456789abcdef',
      }),
    ).toThrow();
    expect(() =>
      DesktopLocalLibraryAuditFindingSchema.parse({
        ...withoutCase(fixture.auditFindingOrphanFile),
        digest: 'not-a-digest',
      }),
    ).toThrow();
  });

  it('干净报告 MUST 携带规模分母', () => {
    const parsed = DesktopLocalLibraryAuditReportSchema.parse(
      withoutCase(fixture.auditReport),
    );
    expect(parsed.findings).toEqual([]);
    // 分母不是可选的礼貌：来自空库的「0 个问题」与来自 500 个包的「0 个问题」含义完全不同。
    expect(Object.keys(parsed).sort()).toEqual([
      'blobMetadataCount',
      'findings',
      'referencedBlobCount',
      'schemaVersion',
      'webPackageCount',
    ]);
  });

  it('GC 结果的五个计数都在，且不接受未知字段', () => {
    const gc = fixture.gcReport;

    const parsed = DesktopLocalLibraryGcReportSchema.parse(withoutCase(gc));
    expect(Object.keys(parsed).sort()).toEqual([
      'bytesReclaimed',
      'filesFailed',
      'filesRemoved',
      'reclaimed',
      'scanned',
    ]);
    expect(() =>
      DesktopLocalLibraryGcReportSchema.parse({ ...parsed, reclaimedTwice: 1 }),
    ).toThrow();
    expect(() =>
      DesktopLocalLibraryGcReportSchema.parse({ ...parsed, bytesReclaimed: -1 }),
    ).toThrow();
  });

  it('GC 错误码与 native 侧一致，且不与审计错误码混用', () => {
    expect(DesktopLocalLibraryGcErrorSchema.shape.code.options).toEqual(fixture.gcErrorCodes);
    // 审计失败说"不知道库怎么样"，GC 失败说"不知道能回收什么"。混用会让用户在库其实
    // 健康时收到一条"本地库已损坏"的告警。
    expect(fixture.gcErrorCodes).not.toEqual(fixture.auditErrorCodes);
    expect(
      DesktopLocalLibraryGcErrorSchema.safeParse({ code: 'audit-failure', message: 'x' }).success,
    ).toBe(false);
  });

  it('报告不接受文件路径——物理布局不进对外契约', () => {
    // 带路径会让「同一份库在两台设备上的审计结果」不同，而那对用户判断毫无价值。
    expect(() =>
      DesktopLocalLibraryAuditReportSchema.parse({
        ...withoutCase(fixture.auditReport),
        dataRoot: 'C:\\Users\\someone\\AppData\\Local\\mahoshojo',
      }),
    ).toThrow();
    expect(() =>
      DesktopLocalLibraryAuditFindingSchema.parse({
        ...withoutCase(fixture.auditFindingOrphanFile),
        path: 'blobs/abc',
      }),
    ).toThrow();
  });
});

interface WebpkgFixture {
  uriScheme: string;
  resourceHost: string;
  windowsResourceHost: string;
  instanceUrlPrefix: string;
  webviewLabelPrefix: string;
  instanceIdExample: string;
  webviewLabelExample: string;
  entryUrlExample: string;
  windowsEntryUrlExample: string;
  commands: { begin: string; append: string; open: string };
  headers: { instanceId: string; resourcePath: string; resourceOffset: string };
  budgets: {
    maxFiles: number;
    maxTotalBytes: number;
    maxAppendChunkBytes: number;
    maxResponseBytes: number;
    maxLiveInstances: number;
    maxLiveBytes: number;
    maxTitleLength: number;
    collectTimeoutSeconds: number;
  };
  errorCodes: string[];
  responseHeaders: {
    base: [string, string][];
    htmlContentSecurityPolicy: string;
    charsetRules: { prefixes: string[]; exact: string[]; suffixes: string[] };
    contentTypeCases: { mediaType: string; contentType: string }[];
  };
  validPaths: string[];
  invalidPaths: string[];
  validMediaTypes: string[];
  invalidMediaTypes: string[];
  beginRequestExample: unknown;
  beginResponseExample: { instanceId: string };
  appendResponseExample: { receivedByteLength: number };
  openRequestExample: { instanceId: string };
  openResponseExample: { label: string };
}

/**
 * webpkg fixture 同样由 Rust 在编译期 `include_str!` 读取
 * （`apps/desktop/src-tauri/src/webpkg_instance.rs`）。这里断言的是契约常量、
 * schema 与 fixture 的**具体取值**相等，而不是两边各自内联期望值。
 */
const webpkgFixture = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'fixtures', 'desktop-web-package-instance.json'),
    'utf8',
  ),
) as WebpkgFixture;

describe('Desktop Web Package 受限 webview IPC 契约（D4b）', () => {
  it('协议与命名常量与 fixture 一致', () => {
    expect(DESKTOP_WEBPKG_URI_SCHEME).toBe(webpkgFixture.uriScheme);
    expect(DESKTOP_WEBPKG_RESOURCE_HOST).toBe(webpkgFixture.resourceHost);
    expect(DESKTOP_WEBPKG_WINDOWS_RESOURCE_HOST).toBe(webpkgFixture.windowsResourceHost);
    expect(DESKTOP_WEBPKG_INSTANCE_URL_PREFIX).toBe(webpkgFixture.instanceUrlPrefix);
    expect(DESKTOP_WEBPKG_WEBVIEW_LABEL_PREFIX).toBe(webpkgFixture.webviewLabelPrefix);
    expect(DESKTOP_WEBPKG_INSTANCE_ID_HEADER).toBe(webpkgFixture.headers.instanceId);
    expect(DESKTOP_WEBPKG_RESOURCE_PATH_HEADER).toBe(webpkgFixture.headers.resourcePath);
    expect(DESKTOP_WEBPKG_RESOURCE_OFFSET_HEADER).toBe(webpkgFixture.headers.resourceOffset);
    // instance URL 前缀的字面值钉在这里；`packages/web-package` 的
    // `WEB_PACKAGE_INSTANCE_PREFIX` 与它的一致性由 resource-space.test.ts 反向断言
    // （contracts 不能反向 import web-package，那会是依赖环）。
    expect(DESKTOP_WEBPKG_INSTANCE_URL_PREFIX).toBe('/__web-package__/instance/');
    // 示例 URL/label 必须真是从常量拼出来的形状，而不是写死在 fixture 里的近似串。
    expect(webpkgFixture.webviewLabelExample).toBe(
      `${DESKTOP_WEBPKG_WEBVIEW_LABEL_PREFIX}${webpkgFixture.instanceIdExample}`,
    );
    expect(webpkgFixture.entryUrlExample).toBe(
      `${DESKTOP_WEBPKG_URI_SCHEME}://${DESKTOP_WEBPKG_RESOURCE_HOST}${DESKTOP_WEBPKG_INSTANCE_URL_PREFIX}${webpkgFixture.instanceIdExample}/index.html`,
    );
    expect(webpkgFixture.windowsEntryUrlExample).toBe(
      `http://${DESKTOP_WEBPKG_WINDOWS_RESOURCE_HOST}${DESKTOP_WEBPKG_INSTANCE_URL_PREFIX}${webpkgFixture.instanceIdExample}/index.html`,
    );
  });

  it('预算常量与 native 侧一致', () => {
    expect(MAX_DESKTOP_WEBPKG_INSTANCE_FILES).toBe(webpkgFixture.budgets.maxFiles);
    expect(MAX_DESKTOP_WEBPKG_INSTANCE_TOTAL_BYTES).toBe(webpkgFixture.budgets.maxTotalBytes);
    expect(MAX_DESKTOP_WEBPKG_APPEND_CHUNK_BYTES).toBe(webpkgFixture.budgets.maxAppendChunkBytes);
    expect(MAX_DESKTOP_WEBPKG_RESPONSE_BYTES).toBe(webpkgFixture.budgets.maxResponseBytes);
    expect(MAX_DESKTOP_WEBPKG_LIVE_INSTANCES).toBe(webpkgFixture.budgets.maxLiveInstances);
    expect(MAX_DESKTOP_WEBPKG_LIVE_BYTES).toBe(webpkgFixture.budgets.maxLiveBytes);
    expect(MAX_DESKTOP_WEBPKG_TITLE_LENGTH).toBe(webpkgFixture.budgets.maxTitleLength);
  });

  it('错误码集合与 native 侧一致且顺序稳定', () => {
    expect(DesktopWebPackageInstanceErrorCodeSchema.options).toEqual(webpkgFixture.errorCodes);
    expect(
      DesktopWebPackageInstanceErrorSchema.parse({ code: 'webpkg-instance-stale', message: 'x' }),
    ).toMatchObject({ code: 'webpkg-instance-stale' });
    expect(
      DesktopWebPackageInstanceErrorSchema.safeParse({ code: 'export-stale', message: 'x' }).success,
    ).toBe(false);
  });

  it('接受 fixture 中每一条合法路径，拒绝每一条非法路径', () => {
    for (const path of webpkgFixture.validPaths) {
      expect(WebPackagePathSchema.safeParse(path).success, `${JSON.stringify(path)} 必须合法`).toBe(true);
    }
    for (const path of webpkgFixture.invalidPaths) {
      expect(WebPackagePathSchema.safeParse(path).success, `${JSON.stringify(path)} 必须被拒`).toBe(false);
    }
    // 超长路径：fixture 不逐字携带 513 字节，由用例现场生成。
    expect(WebPackagePathSchema.safeParse('a'.repeat(513)).success).toBe(false);
    expect(WebPackagePathSchema.safeParse('a'.repeat(512)).success).toBe(true);
    // 长度口径是 UTF-16 code unit：'a'*510 + '😀' = 512 收、511 + '😀' = 513 拒——
    // 与 native `encode_utf16().count()` 同一断言方向。
    expect(WebPackagePathSchema.safeParse(`${'a'.repeat(510)}😀`).success).toBe(true);
    expect(WebPackagePathSchema.safeParse(`${'a'.repeat(511)}😀`).success).toBe(false);
  });

  it('接受 fixture 中每一个合法 mediaType，拒绝每一个非法 mediaType', () => {
    for (const mediaType of webpkgFixture.validMediaTypes) {
      expect(
        WebPackageMediaTypeSchema.safeParse(mediaType).success,
        `${JSON.stringify(mediaType)} 必须合法`,
      ).toBe(true);
    }
    for (const mediaType of webpkgFixture.invalidMediaTypes) {
      expect(
        WebPackageMediaTypeSchema.safeParse(mediaType).success,
        `${JSON.stringify(mediaType)} 必须被拒`,
      ).toBe(false);
    }
  });

  it('接受 fixture 的 begin/open 请求与三个响应形状', () => {
    expect(
      DesktopBeginWebPackageInstanceRequestSchema.parse(webpkgFixture.beginRequestExample),
    ).toEqual(webpkgFixture.beginRequestExample);
    expect(
      DesktopBeginWebPackageInstanceResponseSchema.parse(webpkgFixture.beginResponseExample),
    ).toEqual(webpkgFixture.beginResponseExample);
    expect(
      DesktopAppendWebPackageResourceResponseSchema.parse(webpkgFixture.appendResponseExample),
    ).toEqual(webpkgFixture.appendResponseExample);
    expect(
      DesktopOpenWebPackageInstanceRequestSchema.parse(webpkgFixture.openRequestExample),
    ).toEqual(webpkgFixture.openRequestExample);
    expect(
      DesktopOpenWebPackageInstanceResponseSchema.parse(webpkgFixture.openResponseExample),
    ).toEqual(webpkgFixture.openResponseExample);
  });

  it('begin 请求拒绝未声明 entry、非 html entry、重复路径与越界字节表', () => {
    const example = webpkgFixture.beginRequestExample as {
      entry: string; title: string; files: { path: string; mediaType: string; byteLength: number }[];
    };
    expect(() =>
      DesktopBeginWebPackageInstanceRequestSchema.parse({ ...example, entry: 'missing.html' }),
    ).toThrow();
    expect(() =>
      DesktopBeginWebPackageInstanceRequestSchema.parse({
        ...example,
        entry: 'assets/app.js',
      }),
    ).toThrow();
    expect(() =>
      DesktopBeginWebPackageInstanceRequestSchema.parse({
        ...example,
        files: [...example.files, { path: 'INDEX.HTML', mediaType: 'text/html', byteLength: 1 }],
      }),
    ).toThrow();
    expect(() =>
      DesktopBeginWebPackageInstanceRequestSchema.parse({
        ...example,
        files: [
          { path: 'index.html', mediaType: 'text/html', byteLength: MAX_DESKTOP_WEBPKG_INSTANCE_TOTAL_BYTES },
          { path: 'a.bin', mediaType: 'application/octet-stream', byteLength: 1 },
        ],
      }),
    ).toThrow();
    expect(() =>
      DesktopBeginWebPackageInstanceRequestSchema.parse({ ...example, title: '  ' }),
    ).toThrow();
    // title 长度同为 UTF-16 code unit 口径：126 + 😀 = 128 收，127 + 😀 = 129 拒。
    expect(
      DesktopBeginWebPackageInstanceRequestSchema.safeParse({
        ...example,
        title: `${'t'.repeat(126)}😀`,
      }).success,
    ).toBe(true);
    expect(
      DesktopBeginWebPackageInstanceRequestSchema.safeParse({
        ...example,
        title: `${'t'.repeat(127)}😀`,
      }).success,
    ).toBe(false);
  });

  it('instance id 与 webview label 的形状不可互换', () => {
    // `wpk-7` 是 id，`webpkg-wpk-7` 是 label——互相代入会让 resolver 的钉定检查静默失效。
    expect(DesktopWebPackageInstanceIdSchema.safeParse('wpk-7').success).toBe(true);
    expect(DesktopWebPackageInstanceIdSchema.safeParse('webpkg-wpk-7').success).toBe(false);
    expect(DesktopWebPackageInstanceWebviewLabelSchema.safeParse('webpkg-wpk-7').success).toBe(true);
    expect(DesktopWebPackageInstanceWebviewLabelSchema.safeParse('wpk-7').success).toBe(false);
    expect(DesktopWebPackageInstanceIdSchema.safeParse('wpk-0').success).toBe(false);
    expect(DesktopWebPackageInstanceIdSchema.safeParse('wpk-99999999999999999').success).toBe(false);
  });
});


describe('公开库持久缓存命令（D5.1-K1）', () => {
  it('策略推送只接受三个已登记字段与合法域', () => {
    const { DesktopPublicCachePolicySchema } = desktopIpc;
    expect(DesktopPublicCachePolicySchema.safeParse({
      captureEnabled: true,
      maxBytes: 268435456,
      whenFull: 'pause',
    }).success).toBe(true);
    expect(DesktopPublicCachePolicySchema.safeParse({
      captureEnabled: false,
      maxBytes: 'unlimited',
      whenFull: 'evict-least-recently-used',
    }).success).toBe(true);

    // 0 / 负数 / 非整数 / 未知字符串都不是「无限」——按非法推送拒绝。
    for (const maxBytes of [0, -1, 1.5, '512MiB', 'Infinite', null]) {
      expect(DesktopPublicCachePolicySchema.safeParse({
        captureEnabled: true,
        maxBytes,
        whenFull: 'pause',
      }).success, JSON.stringify(maxBytes)).toBe(false);
    }
    expect(DesktopPublicCachePolicySchema.safeParse({
      captureEnabled: true,
      maxBytes: 268435456,
      whenFull: 'evict',
    }).success).toBe(false);
    expect(DesktopPublicCachePolicySchema.safeParse({
      captureEnabled: true,
      maxBytes: 268435456,
      whenFull: 'pause',
      origin: 'https://evil.example.com',
    }).success).toBe(false);
  });

  it('统计与清理结果的 envelope 形状', () => {
    const {
      DesktopPublicCacheStatsSchema,
      DesktopPublicCacheClearResultSchema,
      DesktopPublicCacheErrorSchema,
    } = desktopIpc;
    const policy = { captureEnabled: true, maxBytes: 268435456, whenFull: 'pause' };
    for (const status of ['empty', 'ready', 'unavailable', 'unsupported-schema']) {
      expect(DesktopPublicCacheStatsSchema.safeParse({
        status,
        path: '/data/public-read-cache.sqlite',
        usageBytes: 1024,
        entryCount: 3,
        summaryCount: 2,
        bodyCount: 1,
        withdrawnCount: 0,
        appliedPolicy: policy,
      }).success, status).toBe(true);
    }
    expect(DesktopPublicCacheStatsSchema.safeParse({
      status: 'corrupt',
      path: '/data/public-read-cache.sqlite',
      usageBytes: 0,
      entryCount: 0,
      summaryCount: 0,
      bodyCount: 0,
      withdrawnCount: 0,
      appliedPolicy: policy,
    }).success).toBe(false);
    expect(DesktopPublicCacheClearResultSchema.safeParse({
      removedEntries: 5,
      freedBytes: 9999,
    }).success).toBe(true);
    expect(DesktopPublicCacheClearResultSchema.safeParse({
      removedEntries: 5,
      freedBytes: 9999,
      path: 'C:/anywhere',
    }).success).toBe(false);
    expect(DesktopPublicCacheErrorSchema.safeParse({
      code: 'storage-unavailable',
      message: 'cache db open failed',
    }).success).toBe(true);
    expect(DesktopPublicCacheErrorSchema.safeParse({
      code: 'config-conflict',
      message: 'not a cache error code',
    }).success).toBe(false);
  });
});
