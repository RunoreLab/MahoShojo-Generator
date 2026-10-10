import type { BattleReportRenderSnapshotV1 } from '@mahoshojo/contracts';
import type { DesktopArenaHostedAnyRecoveryPointer } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import type { WebPackageArtifact, WebPackageRef } from '@mahoshojo/contracts/web-package';
import { createWebPackageOverlayFromBase, type ResolvedWebPackage } from '@mahoshojo/web-package';
import type { ArenaHostedContext, ArenaHostedDetails } from './hosted';
export const sameHostedPackageRef = (a: WebPackageRef, b: WebPackageRef) => a.id === b.id && a.version === b.version && a.digest === b.digest;

/** Delivery-independent validation: a completed producer and a missing Base remain separate facts. */
export const validateHostedOutput = async (
  pointer: DesktopArenaHostedAnyRecoveryPointer, markdown: string, artifact: WebPackageArtifact | undefined,
  context: ArenaHostedContext, signal: AbortSignal, assertCurrent: () => void, frozenBase?: ResolvedWebPackage,
): Promise<Pick<ArenaHostedDetails, 'outputValidation' | 'validationMessage'> & { renderSnapshot?: BattleReportRenderSnapshotV1 }> => {
  let outputValidation: ArenaHostedDetails['outputValidation'] = markdown.trim() ? 'valid' : 'invalid';
  let validationMessage: string | null = markdown.trim() ? null : '服务器已完成，但未取得有效正文。';
  const renderSnapshot: BattleReportRenderSnapshotV1 | undefined = pointer.format === 'web' ? { version: 1, reportFormat: 'web' } : undefined;
  if (pointer.webPackageRef) {
    if (!artifact || !sameHostedPackageRef(artifact.packageRef, pointer.webPackageRef)) {
      outputValidation = 'invalid'; validationMessage = '服务器已完成，但包身份或 Artifact 不匹配，不能确认目标正文。';
    } else {
      renderSnapshot!.webPackage = artifact;
      let base = frozenBase;
      if (!base && context.resolveWebPackage) { try { base = await context.resolveWebPackage(pointer.webPackageRef); } catch { /* Missing Base is not producer failure. */ } }
      signal.throwIfAborted(); assertCurrent();
      if (!base) {
        outputValidation = 'missing-base'; validationMessage = '服务器已完成，精确 Base 缺失；原文与 Artifact 可完整导出。导包本身不会重新取得活动历史保存资格；若服务端仍保留结果，可导入精确版本后显式恢复复验。';
      } else {
        try {
          const overlay = await createWebPackageOverlayFromBase(base, markdown); signal.throwIfAborted(); assertCurrent();
          if (!sameHostedPackageRef(overlay.packageRef, artifact.packageRef) || overlay.targetPath !== artifact.targetPath
            || overlay.targetMediaType !== artifact.targetMediaType || overlay.generatedDigest !== artifact.generatedDigest) throw new Error('artifact mismatch');
        } catch (error) {
          if (signal.aborted || context.isCurrent?.() === false) throw error;
          outputValidation = 'invalid'; validationMessage = '服务器已完成，但目标正文未通过精确包校验，原文仍可导出。';
        }
      }
    }
  }
  return { outputValidation, validationMessage, renderSnapshot };
};
