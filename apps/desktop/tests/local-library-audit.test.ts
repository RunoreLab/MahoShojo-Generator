import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  DesktopLocalLibraryAuditFinding,
  DesktopLocalLibraryAuditReport,
  DesktopLocalLibraryGcReport as GcReport,
} from '@mahoshojo/contracts/desktop-ipc';

import {
  collectLocalLibraryGarbage,
  gcReclaimedSomething,
  runLocalLibraryAudit,
  summarizeLocalLibraryAudit,
  type LocalLibraryAuditSummary,
} from '../src/platform/local-library-audit';

interface AuditFixtureSection {
  gcReport: Record<string, unknown> & { $case?: string };
  auditReport: Record<string, unknown> & { $case?: string };
  auditFindingReferenceFileMissing: Record<string, unknown> & { $case?: string };
  auditFindingBytesMismatchEqualLength: Record<string, unknown> & { $case?: string };
  auditFindingUnreferencedMetadata: Record<string, unknown> & { $case?: string };
  auditFindingOrphanFile: Record<string, unknown> & { $case?: string };
  auditFindingRecordWithoutReference: Record<string, unknown> & { $case?: string };
  auditFindingForeignKeyViolation: Record<string, unknown> & { $case?: string };
}

/**
 * 读的是**同一份**跨运行时 fixture（DESK-033）。
 *
 * 这里刻意不内联一份期望值：内联的副本在 native 改桶时会静默继续通过，而这正是
 * DESK-033 要防的那类漂移。
 */
const readFixture = (): AuditFixtureSection => {
  const parsed = JSON.parse(
    readFileSync(
      path.resolve(
        process.cwd(),
        '..',
        '..',
        'packages',
        'contracts',
        'fixtures',
        'desktop-local-cards.json',
      ),
      'utf8',
    ),
  ) as { maintenance: AuditFixtureSection };
  return parsed.maintenance;
};

const stripCase = <T extends Record<string, unknown>>(value: T): Omit<T, '$case'> => {
  const { $case: _case, ...rest } = value;
  expect(_case).toEqual(expect.any(String));
  return rest;
};

const asFinding = (value: Record<string, unknown>): DesktopLocalLibraryAuditFinding =>
  stripCase(value) as unknown as DesktopLocalLibraryAuditFinding;

const asReport = (
  findings: DesktopLocalLibraryAuditFinding[],
  overrides: Partial<DesktopLocalLibraryAuditReport> = {},
): DesktopLocalLibraryAuditReport =>
  ({
    findings,
    schemaVersion: 4,
    referencedBlobCount: 1,
    blobMetadataCount: 1,
    webPackageCount: 1,
    ...overrides,
  }) as DesktopLocalLibraryAuditReport;

describe('桌面本地库审计', () => {
  const fixture = readFixture();

  it('空报告按"没有该类问题"呈现，且保留规模分母', () => {
    const summary = summarizeLocalLibraryAudit(
      asReport([], {
        referencedBlobCount: 12,
        blobMetadataCount: 13,
        webPackageCount: 12,
      }),
    );

    expect(summary.buckets).toEqual([]);
    expect(summary.hasDamage).toBe(false);
    expect(summary.hasReclaimableSpace).toBe(false);
    // 分母必须透传：来自空库的「0 个问题」与来自满库的「0 个问题」含义完全不同。
    expect(summary.referencedBlobCount).toBe(12);
    expect(summary.blobMetadataCount).toBe(13);
    expect(summary.webPackageCount).toBe(12);
  });

  it('按契约固定顺序分组，而不是按发现出现的顺序', () => {
    const summary: LocalLibraryAuditSummary = summarizeLocalLibraryAudit(
      asReport([
        asFinding(fixture.auditFindingForeignKeyViolation),
        asFinding(fixture.auditFindingOrphanFile),
        asFinding(fixture.auditFindingRecordWithoutReference),
      ]),
    );

    expect(summary.buckets.map((bucket) => bucket.kind)).toEqual([
      'orphan-file',
      'record-without-reference',
      'foreign-key-violation',
    ]);
    expect(summary.buckets.every((bucket) => bucket.count === 1)).toBe(true);
  });

  it('只有用户可见的损坏才触发报警，可回收候选只提示可清理', () => {
    const reclaimable = summarizeLocalLibraryAudit(
      asReport([
        asFinding(fixture.auditFindingOrphanFile),
        asFinding(fixture.auditFindingUnreferencedMetadata),
      ]),
    );
    expect(reclaimable.hasReclaimableSpace).toBe(true);
    expect(reclaimable.hasDamage).toBe(false);

    for (const damaging of [
      fixture.auditFindingReferenceFileMissing,
      fixture.auditFindingRecordWithoutReference,
      fixture.auditFindingBytesMismatchEqualLength,
    ]) {
      const summary = summarizeLocalLibraryAudit(asReport([asFinding(damaging)]));
      expect(summary.hasDamage, `${String(damaging['kind'])} MUST 触发报警`).toBe(true);
    }

    // 外键违规单独出现时不重复报警：它的症状必然落到某个损坏桶里，同一件事报两次
    // 会让用户以为有两个独立问题。
    const foreignKeyOnly = summarizeLocalLibraryAudit(
      asReport([asFinding(fixture.auditFindingForeignKeyViolation)]),
    );
    expect(foreignKeyOnly.hasDamage).toBe(false);
    expect(foreignKeyOnly.buckets).toHaveLength(1);
  });

  it('拒绝 native 返回的未知桶——不静默丢弃也不静默接受', () => {
    // 静默接受会让 native 新增的桶在 UI 上完全不可见；静默丢弃会让用户以为库是干净的。
    expect(() =>
      summarizeLocalLibraryAudit(
        asReport([{ kind: 'totally-new-bucket' } as unknown as DesktopLocalLibraryAuditFinding]),
      ),
    ).toThrow();
  });

  it('维护窗口内的写入被拒时重试，而不是把错误抛给用户', async () => {
    const report = asReport([]);
    let calls = 0;
    const invoke = async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('busy'), { code: 'maintenance-busy' });
      }
      return report;
    };

    const summary = await runLocalLibraryAudit(invoke, { retryOnMaintenance: 3 });
    expect(calls).toBe(2);
    // 分组后的形状没有 `findings` 字段——断言 `buckets` 而不是断言一个不存在的属性，
    // 后者恒为 undefined，会让这条断言在实现被改坏时依然通过。
    expect(summary.buckets).toEqual([]);
  });

  it('持续被拒时以可诊断错误失败，且不无限重试', async () => {
    let calls = 0;
    const invoke = async () => {
      calls += 1;
      throw Object.assign(new Error('busy'), { code: 'maintenance-busy' });
    };

    await expect(runLocalLibraryAudit(invoke, { retryOnMaintenance: 2 })).rejects.toThrow();
    expect(calls, '重试次数必须有界，否则 UI 会永远转圈').toBe(2);
  });

  it('native 的审计错误码被保留，不被压成笼统失败', async () => {
    const invoke = async () => {
      throw {
        code: 'audit-unavailable',
        message: 'the local library is unavailable for auditing',
      };
    };

    await expect(runLocalLibraryAudit(invoke)).rejects.toMatchObject({
      code: 'audit-unavailable',
    });
  });

  it('GC 走同一套维护重试——它同样持有窗口', async () => {
    const report = stripCase(fixture.gcReport);
    let calls = 0;
    const invoke = async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('busy'), { code: 'maintenance-busy' });
      }
      return report;
    };

    const summary = await collectLocalLibraryGarbage(invoke, { retryOnMaintenance: 3 });
    expect(calls).toBe(2);
    expect(summary.reclaimed).toBe(2);
  });

  it('区分"候选集是空的"与"回收到了东西"', () => {
    const gcReport = stripCase(fixture.gcReport) as unknown as GcReport;
    // fixture 本身代表一次成功的回收。
    expect(gcReclaimedSomething(gcReport)).toBe(true);

    // scanned === 0：库干净，或用户还没 purge 任何东西。
    expect(gcReclaimedSomething({ ...gcReport, scanned: 0, reclaimed: 0 })).toBe(false);
    // scanned > 0 但 reclaimed === 0：候选集里有东西却被条件 DELETE 挡住了。这值得让用户
    // 知道，而不是显示成"没有可回收的空间"。
    expect(gcReclaimedSomething({ ...gcReport, scanned: 3, reclaimed: 0 })).toBe(false);
  });

  it('GC 的错误码不被压成审计错误码', async () => {
    // 混用会让用户在库其实健康时收到"本地库已损坏"。两类错误是不同的事。
    const invoke = async () => {
      throw { code: 'gc-unavailable', message: 'the local library is unavailable for collection' };
    };
    await expect(collectLocalLibraryGarbage(invoke)).rejects.toMatchObject({
      code: 'gc-unavailable',
    });
  });
});
