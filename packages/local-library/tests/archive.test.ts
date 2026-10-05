import {
  LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION,
  LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH,
  LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH as MANIFEST_PATH_ALIAS,
  LocalLibraryArchiveManifestV2Schema,
  localLibraryArchiveCardPath,
  localLibraryArchiveStem,
  localLibraryArchiveWebPackageArchivePath,
  localLibraryArchiveWebPackagePath,
  parseLocalLibraryArchiveCard,
  parseLocalLibraryArchiveWebPackage,
} from '@mahoshojo/local-library/archive';
import { deriveLocalWebPackageId } from '@mahoshojo/local-library/web-package-record';

import { createLocalWebPackageRecord } from './web-package-fixtures';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);
const HEX_D = 'd'.repeat(64);

const contentDigest = (hex: string): string => `sha256:${hex}`;
const exportedAt = '2026-08-23T13:00:00.000Z';

/** 卡片条目：path 可以任意（`lc_` 前缀已保证大小写安全）。 */
const cardEntry = (id = 'lc_1', hex = HEX_A) => ({
  cardId: id,
  path: `cards/${id}.json`,
  contentDigest: contentDigest(hex),
  checksum: contentDigest(HEX_B),
  byteLength: 1024,
});

/** Web 包条目：`contentDigest`（manifest 摘要）与 `archiveDigest`（ZIP 字节摘要）不同。 */
const webPackageEntry = (manifestHex = HEX_C, archiveHex = HEX_D) => {
  const digest = contentDigest(manifestHex);
  return {
    packageId: deriveLocalWebPackageId(digest),
    path: 'web-packages/wp_1.json',
    contentDigest: digest,
    checksum: contentDigest(HEX_B),
    byteLength: 512,
    archivePath: `archives/${archiveHex}.zip`,
    archiveDigest: contentDigest(archiveHex),
    archiveByteLength: 2048,
  };
};

const createManifest = () => ({
  format: 'mahoshojo-local-library',
  formatVersion: 2,
  cardSchemaVersion: 1,
  webPackageSchemaVersion: 1,
  exportedAt,
  cardCount: 1,
  webPackageCount: 1,
  cards: [cardEntry()],
  webPackages: [webPackageEntry()],
});

describe('LocalLibraryArchiveManifestV2', () => {
  it('round-trips a manifest using JSON only', () => {
    const manifest = LocalLibraryArchiveManifestV2Schema.parse(createManifest());
    expect(LocalLibraryArchiveManifestV2Schema.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('starts at format version 2, not 1', () => {
    // V1 零 producer、零 consumer，野外不存在 V1 归档。第一个真实格式占 2，好过让将来的
    // 读取器以为自己需要处理一个从未见过的历史版本。
    expect(LOCAL_LIBRARY_ARCHIVE_FORMAT_VERSION).toBe(2);
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({ ...createManifest(), formatVersion: 1 }).success).toBe(false);
  });

  it('keeps card and web package schema versions separate', () => {
    // 合成一个数字会在其中一方升级时给出错误信息：读取器无法知道它能读懂哪一种。
    const manifest = createManifest();
    expect(LocalLibraryArchiveManifestV2Schema.safeParse(manifest).success).toBe(true);
    expect(
      LocalLibraryArchiveManifestV2Schema.safeParse({ ...manifest, schemaVersion: 1 }).success,
    ).toBe(false);
  });

  it('accepts web packages whose contentDigest and archiveDigest differ', () => {
    // DESK-063：manifest 摘要 ≠ ZIP 字节摘要。若这里失败，症状会是"所有包都导入失败"，
    // 因为每一条真实包的这两个摘要必然不同。
    expect(LocalLibraryArchiveManifestV2Schema.safeParse(createManifest()).success).toBe(true);
  });

  it('accepts an empty library', () => {
    // 没有任何本地记录的用户是真实存在的；导出必须成功，而不是因为"必填至少一条"而报错。
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      cardCount: 0,
      webPackageCount: 0,
      cards: [],
      webPackages: [],
    }).success).toBe(true);
  });

  it('rejects traversal paths, duplicate entries, and mismatched counts', () => {
    for (const path of ['cards/../secret.json', 'cards/LOCAL-card-1.json', 'cards/con.json', 'cards/con.txt.json', 'cards/card-name..json']) {
      expect(LocalLibraryArchiveManifestV2Schema.safeParse({
        ...createManifest(),
        cards: [{ ...cardEntry(), path }],
      }).success).toBe(false);
    }
    for (const path of ['web-packages/../secret.json', 'web-packages/CON.json', 'web-packages/wp_1.jsonx']) {
      expect(LocalLibraryArchiveManifestV2Schema.safeParse({
        ...createManifest(),
        webPackages: [{ ...webPackageEntry(), path }],
      }).success).toBe(false);
    }
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      cardCount: 2,
      cards: [cardEntry(), cardEntry()],
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackageCount: 0,
    }).success).toBe(false);
  });

  it('rejects a duplicate packageId', () => {
    const first = webPackageEntry();
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackageCount: 2,
      webPackages: [first, { ...first, path: 'web-packages/wp_2.json' }],
    }).success).toBe(false);
  });

  it('rejects two packages claiming the same archive path', () => {
    // 同一个 ZIP 字节被两个包引用是可能的（manifest 不同、字节相同），但两个条目写同一个
    // archivePath 就是导出侧的 bug：解包时后者会静默覆盖前者。
    const first = webPackageEntry(HEX_C, HEX_D);
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackageCount: 2,
      webPackages: [first, { ...webPackageEntry(HEX_A, HEX_D), path: 'web-packages/wp_2.json' }],
    }).success).toBe(false);
  });

  it('rejects a card and a web package colliding on a record path', () => {
    // 路径唯一性覆盖整个归档，不只是每个命名空间内部。
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      cardCount: 0,
      webPackageCount: 2,
      webPackages: [
        { ...webPackageEntry(), path: 'web-packages/collide.json' },
        { ...webPackageEntry(HEX_A, HEX_A), path: 'web-packages/collide.json' },
      ],
    }).success).toBe(false);
  });

  it('requires archivePath to be derived from archiveDigest', () => {
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackages: [{ ...webPackageEntry(), archivePath: `archives/${HEX_C}.zip` }],
    }).success).toBe(false);
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackages: [{ ...webPackageEntry(), archivePath: `archives/${HEX_D.toUpperCase()}.zip` }],
    }).success).toBe(false);
  });

  it('has no fields for Provider secrets or project authentication material', () => {
    for (const secret of [
      { apiKey: 'secret' },
      { authkey: 'legacy-secret' },
      { token: 'secret' },
    ]) {
      expect(LocalLibraryArchiveManifestV2Schema.safeParse({ ...createManifest(), ...secret }).success).toBe(false);
    }
    // Web 包记录里也没有：strict 继承自记录契约。
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackages: [{ ...webPackageEntry(), apiKey: 'secret' }],
    }).success).toBe(false);
  });
});

describe('localLibraryArchiveStem', () => {
  it('produces paths the schema accepts for realistic and hostile ids', () => {
    const ids = [
      'lc_' + HEX_A.slice(0, 32),
      'wp_' + HEX_C.slice(0, 32),
      'A Card With Spaces',
      'with/slash\\and:colon',
      '..',
      '.',
      '',
      'con',
      'nul',
      'com1',
      'lpt9',
      'con.txt',
      '中文标题',
      'x'.repeat(300),
      '-leading-dash',
      'trailing-dash-',
      '...',
    ];
    for (const id of ids) {
      const stem = localLibraryArchiveStem(id);
      // 形状约束：只允许小写字母、数字、点、下划线、连字符。
      expect(stem, `stem for ${JSON.stringify(id)}`).toMatch(/^[a-z0-9][a-z0-9._-]{0,95}$/u);
      expect(stem.endsWith('.'), `stem for ${JSON.stringify(id)} must not end with a dot`).toBe(false);
      // Windows 保留设备名。
      expect(
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u.test(stem),
        `stem for ${JSON.stringify(id)} must not be a Windows reserved device name`,
      ).toBe(false);
      // 关键：派生出来的完整路径必须**被 schema 接受**。这条让"stem 规则与路径 schema
      // 漂移"变成一次失败，而不是一次导入失败。
      expect(
        LocalLibraryArchiveManifestV2Schema.safeParse({
          ...createManifest(),
          cards: [{ ...cardEntry(), path: localLibraryArchiveCardPath(stem) }],
        }).success,
        `card path for ${JSON.stringify(id)} must satisfy the schema`,
      ).toBe(true);
      expect(
        LocalLibraryArchiveManifestV2Schema.safeParse({
          ...createManifest(),
          webPackages: [{ ...webPackageEntry(), path: localLibraryArchiveWebPackagePath(stem) }],
        }).success,
        `web package path for ${JSON.stringify(id)} must satisfy the schema`,
      ).toBe(true);
    }
  });

  it('escapes Windows reserved device names instead of emitting them', () => {
    // 这条是上一条的子集但值得单列：`con` 归一化后**恰好**仍是 `con`——只做字符替换和
    // 首尾修整的 stem 函数会把它原样吐出，于是 `cards/con.json` 在 Windows 上无法创建。
    // schema 会拒绝它，于是用户看到的是"导出的归档自己打不开"，而原因藏在派生规则里。
    for (const id of ['con', 'CON', 'nul', 'aux', 'prn', 'com1', 'lpt1', 'con.txt']) {
      expect(localLibraryArchiveStem(id), `reserved name ${id} must be escaped`).not.toBe(id.toLowerCase());
    }
  });

  it('falls back to a usable stem when nothing survives normalization', () => {
    // 全是保留符号的 id 不能产出空 stem——空 stem 会变成 `cards/.json`，而它在 Windows 上
    // 指向目录自身的元数据。
    for (const id of ['///', '...', '---', '  ']) {
      expect(localLibraryArchiveStem(id)).toBe('entry');
    }
  });

  it('keeps a stem stable across calls, so two exports produce identical paths', () => {
    // 稳定性让"两次导出产出相同归档"成立。追加哈希或计数器会让它随库增长而变化。
    const id = 'A Card With Spaces';
    expect(localLibraryArchiveStem(id)).toBe(localLibraryArchiveStem(id));
  });

  it('builds a path the schema accepts for every stem it can produce', () => {
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      cards: [{ ...cardEntry(), path: localLibraryArchiveCardPath(localLibraryArchiveStem('a card')) }],
    }).success).toBe(true);
    expect(LocalLibraryArchiveManifestV2Schema.safeParse({
      ...createManifest(),
      webPackages: [
        { ...webPackageEntry(), path: localLibraryArchiveWebPackagePath(localLibraryArchiveStem('a package')) },
      ],
    }).success).toBe(true);
  });
});

describe('archive path helpers', () => {
  it('derives the archive path from the digest, so callers cannot pass a stem', () => {
    // 只接受 digest 的签名让"用 stem 命名归档字节"在类型上不可表达——那会让路径与
    // 完整性声明脱节，而那正是 DESK-059b 要禁的形态。
    expect(localLibraryArchiveWebPackageArchivePath(contentDigest(HEX_D))).toBe(`archives/${HEX_D}.zip`);
  });

  it('exposes the manifest path from one place', () => {
    expect(LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH).toBe('manifest.json');
    expect(MANIFEST_PATH_ALIAS).toBe(LOCAL_LIBRARY_ARCHIVE_MANIFEST_PATH);
  });
});

describe('archive record parsing', () => {
  const cardRecord = {
    id: 'lc_1',
    schemaVersion: 1,
    storageLocation: 'local',
    cardType: 'character',
    title: 'a card',
    data: { answer: 1 },
    contentDigest: contentDigest(HEX_A),
    provenance: { kind: 'unsigned' },
    createdAt: exportedAt,
    updatedAt: exportedAt,
  };

  it('parses a card record and returns only the validated copy', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(cardRecord));
    const record = parseLocalLibraryArchiveCard(bytes);
    expect(record.id).toBe('lc_1');
    // 返回值是 schema 校验后的副本，调用方拿不到未经校验的原文。
    expect(record.data).toEqual({ answer: 1 });
  });

  it('rejects a card record whose bytes are not valid UTF-8', () => {
    // 非 fatal 解码会用 U+FFFD 静默替换，于是"校验通过的记录"与"用户导出的字节"不再对应，
    // 而 checksum 的全部价值就在这个对应关系上。
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    expect(() => parseLocalLibraryArchiveCard(bytes)).toThrow();
  });

  it('rejects a record whose bytes are not JSON at all', () => {
    // 这条覆盖"解析失败"与"校验失败"必须是同一类错误：调用方逐条 try、失败记进报告，
    // 但任何单独 catch ZodError 做分类统计的代码都依赖这一点。
    const bytes = new TextEncoder().encode('not json at all');
    expect(() => parseLocalLibraryArchiveCard(bytes)).toThrow(/.*/u);
    let thrown: unknown;
    try {
      parseLocalLibraryArchiveCard(bytes);
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain('SyntaxError');
  });

  it('parses a well-formed web package record', () => {
    // 夹具复用 web-package-fixtures 的构造器，而不是就地手搓一个：那份夹具已经满足
    // canonical identity 等全部不变量，手搓版本早晚会漂移成一份过期的平行定义。
    const record = createLocalWebPackageRecord();
    const parsed = parseLocalLibraryArchiveWebPackage(new TextEncoder().encode(JSON.stringify(record)));
    expect(parsed.id).toBe(record.id);
    expect(parsed.contentDigest).toBe(record.contentDigest);
  });

  it('rejects a web package record whose id is not derived from its ref digest', () => {
    // canonical identity 住在记录契约里，因此 Desktop 与 Web 两侧都有保证
    // （web-package-record.ts 记录了这个不变量此前只在 Web 的 put 里被检查）。
    const record = createLocalWebPackageRecord({ id: 'wp_deadbeef' });
    expect(() => parseLocalLibraryArchiveWebPackage(new TextEncoder().encode(JSON.stringify(record)))).toThrow();
  });

  it('rejects a record carrying an unknown field', () => {
    // 归档是外来输入。strict 让"未来字段"不会在旧读取器里被静默忽略后当成已理解。
    const record = { ...cardRecord, apiKey: 'secret' };
    expect(() => parseLocalLibraryArchiveCard(new TextEncoder().encode(JSON.stringify(record)))).toThrow();
  });
});
