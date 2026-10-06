import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  DesktopLocalLibraryAuditFinding,
  DesktopLocalLibraryAuditKind,
  DesktopLocalLibraryGcReport,
} from '@mahoshojo/contracts/desktop-ipc';

import { formatBytes } from '../../platform/format-bytes';
import {
  collectLocalLibraryGarbage,
  DesktopLocalLibraryAuditError,
  DesktopLocalLibraryGcError,
  runLocalLibraryAudit,
  type InvokeFn,
  type LocalLibraryAuditSummary,
} from '../../platform/local-library-audit';

interface LocalLibraryAuditPanelProps {
  readonly enabled: boolean;
  /** 页面级维护互斥正被其他操作持有（含本面板自己的——`busy` 已先行覆盖）。 */
  readonly maintenanceBusy: boolean;
  readonly acquireOperation: () => boolean;
  readonly releaseOperation: () => void;
}

const invokeNative: InvokeFn = (command, args) => invoke(command, args as never);

/** 桶的用户文案——按契约常量的含义写，不按 kind 字面直译。 */
const BUCKET_LABELS: Record<DesktopLocalLibraryAuditKind, string> = {
  'reference-file-missing': '包找不到内容文件',
  'reference-bytes-mismatch': '内容文件与记录的摘要或长度不符',
  'record-without-reference': '包记录缺少内容引用（表现为打不开）',
  'unreferenced-metadata': '无引用的内容记录（可回收空间）',
  'orphan-file': '无记录的文件（可回收空间）',
  'foreign-key-violation': '数据库外键违规',
};

const DAMAGE_KINDS: ReadonlySet<string> = new Set([
  'reference-file-missing',
  'reference-bytes-mismatch',
  'record-without-reference',
]);

const shortDigest = (digest: string): string => (digest.length > 12 ? `${digest.slice(0, 12)}…` : digest);

/** 一条 finding 的一行定位信息；报告本身不携带文件路径（`DESK-057`）。 */
const describeFinding = (finding: DesktopLocalLibraryAuditFinding): string => {
  switch (finding.kind) {
    case 'reference-file-missing':
      return `包 ${finding.packageId} → 内容 ${shortDigest(finding.digest)}`;
    case 'reference-bytes-mismatch':
      return `包 ${finding.packageId} → 内容 ${shortDigest(finding.digest)}：记录 ${formatBytes(finding.expectedByteLength)} / 实际 ${formatBytes(finding.actualByteLength)}${finding.lengthMatches ? '' : '（长度不符）'}`;
    case 'record-without-reference':
      return `包 ${finding.packageId}`;
    case 'unreferenced-metadata':
      return `内容 ${shortDigest(finding.digest)}`;
    case 'orphan-file':
      return `内容 ${shortDigest(finding.digest)} · ${formatBytes(finding.byteLength)}`;
    case 'foreign-key-violation':
      return `表 ${finding.table} 行 ${finding.rowId} → ${finding.parent} ${finding.foreignKeyId}`;
  }
};

const BUCKET_DETAIL_LIMIT = 5;

const describeAuditError = (cause: unknown): string =>
  cause instanceof DesktopLocalLibraryAuditError ? cause.message : '本地库完整性检查未能完成，请重试。';

const describeGcError = (cause: unknown): string =>
  cause instanceof DesktopLocalLibraryGcError ? cause.message : '本地库空间清理未能完成，请重试。';

const describeGcReport = (report: DesktopLocalLibraryGcReport): { readonly tone: 'status' | 'alert'; readonly text: string } => {
  if (report.scanned === 0) return { tone: 'status', text: '没有发现可回收的内容。' };
  const fragments = [`已清理 ${report.reclaimed} 条记录`];
  if (report.filesRemoved > 0) fragments.push(`删除 ${report.filesRemoved} 个文件`);
  if (report.bytesReclaimed > 0) fragments.push(`释放 ${formatBytes(report.bytesReclaimed)}`);
  if (report.filesRemoved < report.reclaimed) {
    fragments.push(`${report.reclaimed - report.filesRemoved} 条记录本来就没有对应文件`);
  }
  if (report.filesFailed > 0) {
    return {
      tone: 'alert',
      text: `${fragments.join('，')}。另有 ${report.filesFailed} 个文件未能删除（权限或读写错误），它们会保留为无记录文件。`,
    };
  }
  if (report.reclaimed === 0) {
    return { tone: 'status', text: `发现 ${report.scanned} 个回收候选，但未能回收；请稍后重试。` };
  }
  return { tone: 'status', text: `${fragments.join('，')}。` };
};

/**
 * 本地库完整性审计面板（D2.2b/D2.2c 的产品面）。
 *
 * `audit_local_library` 与 `collect_local_garbage` 的 native 侧早就交付，本面板是它们唯一的
 * 用户入口：审计只报告不修复，GC 只回收无引用 blob。两者都在 native 侧持有维护窗口——
 * 因此面板操作一律包在页面级维护互斥里，且桥接层会对 `maintenance-busy` 做有界重试。
 */
export const LocalLibraryAuditPanel = ({ enabled, maintenanceBusy, acquireOperation, releaseOperation }: LocalLibraryAuditPanelProps) => {
  const [summary, setSummary] = useState<LocalLibraryAuditSummary | null>(null);
  const [gcOutcome, setGcOutcome] = useState<{ readonly tone: 'status' | 'alert'; readonly text: string } | null>(null);
  const [busy, setBusy] = useState<'audit' | 'gc' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = useCallback(async (): Promise<boolean> => {
    try {
      const result = await runLocalLibraryAudit(invokeNative);
      setSummary(result);
      return true;
    } catch (cause) {
      setError(describeAuditError(cause));
      return false;
    }
  }, []);

  const handleAudit = useCallback(() => {
    if (!enabled || busy !== null || !acquireOperation()) return;
    setBusy('audit');
    setError(null);
    setGcOutcome(null);
    void runAudit().finally(() => {
      setBusy(null);
      releaseOperation();
    });
  }, [acquireOperation, busy, enabled, releaseOperation, runAudit]);

  const handleCollect = useCallback(() => {
    if (!enabled || busy !== null || !acquireOperation()) return;
    setBusy('gc');
    setError(null);
    setGcOutcome(null);
    void (async () => {
      const report = await collectLocalLibraryGarbage(invokeNative);
      setGcOutcome(describeGcReport(report));
      // 回收改变了库状态：重跑一次审计让面板显示的是回收后的真实状态，
      // 而不是把回收前报告留在原地冒充现状。GC 只收无引用 blob，卡列表不受影响。
      await runAudit();
    })()
      .catch((cause: unknown) => setError(describeGcError(cause)))
      .finally(() => {
        setBusy(null);
        releaseOperation();
      });
  }, [acquireOperation, busy, enabled, releaseOperation, runAudit]);

  const actionClass =
    'rounded border border-(--app-border) px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4" aria-labelledby="local-audit-heading">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="local-audit-heading" className="text-sm font-medium">本地库完整性</h2>
          <p className="mt-1 text-sm text-(--app-text-muted)">
            检查记录与内容文件是否一致——检查只报告不修复；清理只回收没有被任何记录引用的内容。
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={actionClass} disabled={!enabled || busy !== null || maintenanceBusy} onClick={handleAudit}>
            {busy === 'audit' ? '正在检查…' : '检查完整性'}
          </button>
          <button
            type="button"
            className={actionClass}
            disabled={!enabled || busy !== null || maintenanceBusy || summary === null || !summary.hasReclaimableSpace}
            title={summary === null ? '先检查完整性' : undefined}
            onClick={handleCollect}
          >
            {busy === 'gc' ? '正在清理…' : '清理可回收空间'}
          </button>
        </div>
      </header>

      {error !== null && <p role="alert" className="mt-3 text-sm text-(--app-accent-strong)">{error}</p>}
      {gcOutcome !== null && (
        <p role={gcOutcome.tone === 'alert' ? 'alert' : 'status'} className="mt-3 text-sm">
          {gcOutcome.text}
        </p>
      )}

      {summary !== null && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <p className="text-(--app-text-muted)">
            本次检查覆盖 {summary.webPackageCount} 个包 / {summary.referencedBlobCount} 份引用内容 / {summary.blobMetadataCount} 条内容记录。
          </p>
          {summary.buckets.length === 0 ? (
            <p role="status">未发现不一致。</p>
          ) : (
            <>
              {summary.hasDamage && (
                <p role="alert" className="text-(--app-accent-strong)">
                  发现可能影响使用的问题：受影响的包会打不开或内容不符。归档导出会跳过打不开的内容。
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {summary.buckets.map((bucket) => (
                  <li key={bucket.kind} className="rounded border border-(--app-border) p-3">
                    <p className={DAMAGE_KINDS.has(bucket.kind) ? 'font-medium text-(--app-accent-strong)' : 'font-medium'}>
                      {BUCKET_LABELS[bucket.kind]}（{bucket.count} 条）
                    </p>
                    <ul className="mt-2 flex flex-col gap-1 text-xs text-(--app-text-muted)">
                      {bucket.findings.slice(0, BUCKET_DETAIL_LIMIT).map((finding, index) => (
                        <li key={index} className="break-all">{describeFinding(finding)}</li>
                      ))}
                      {bucket.count > BUCKET_DETAIL_LIMIT && <li>……共 {bucket.count} 条</li>}
                    </ul>
                  </li>
                ))}
              </ul>
              {summary.hasReclaimableSpace && (
                <p className="text-(--app-text-muted)">
                  存在可回收空间。「清理可回收空间」只删除无引用内容，不会移除任何数据卡或包记录。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};
