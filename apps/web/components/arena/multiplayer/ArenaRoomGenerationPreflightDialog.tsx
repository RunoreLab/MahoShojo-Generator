'use client';

import { BaseModal } from '@/components/shared/BaseModal';
import { buttonClassName } from '@/components/shared/ui/Button';
import type { ArenaRoomHostWorkspaceDirtyReason } from '@/lib/arena-room/host-workspace';

export type ArenaRoomGenerationPreflightChoice = 'cancel' | 'publish' | 'sync-room' | 'confirm-start';

type Props = Readonly<{
  isOpen: boolean;
  reasons: readonly ArenaRoomHostWorkspaceDirtyReason[];
  canPublish: boolean;
  canConfirmStart: boolean;
  pendingProposalCount?: number;
  busy: boolean;
  onChoice: (choice: ArenaRoomGenerationPreflightChoice) => void;
}>;

const reasonText: Readonly<Record<ArenaRoomHostWorkspaceDirtyReason, string>> = {
  'shared-config': '本地编辑与当前房间配置不同。',
  'host-local-content': '本地角色、情景或素材的完整正文已变更。',
  'baseline-missing': '当前页面没有这个房间的本地内容发布基准。',
  'working-copy-invalid': '当前本地编辑草稿无法转换为可共享的房间配置。',
};

export function ArenaRoomGenerationPreflightDialog({
  isOpen,
  reasons,
  canPublish,
  canConfirmStart,
  pendingProposalCount = 0,
  busy,
  onChoice,
}: Props) {
  const dirty = reasons.length > 0;
  return (
    <BaseModal
      isOpen={isOpen}
      title="确认多人生成配置"
      description="房间配置是下一次多人生成的唯一共享语义权威。"
      maxWidthClassName="max-w-xl"
      onClose={() => {
        if (!busy) onChoice('cancel');
      }}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={buttonClassName()}
            disabled={busy}
            onClick={() => onChoice('cancel')}
          >
            取消
          </button>
          {dirty ? (
            <>
              <button
                type="button"
                className={buttonClassName()}
                disabled={busy}
                onClick={() => onChoice('sync-room')}
              >
                放弃本地修改，同步房间配置
              </button>
              <button
                type="button"
                className={buttonClassName({ variant: 'primary' })}
                disabled={busy || !canPublish}
                onClick={() => onChoice('publish')}
              >
                更新房间配置并开始
              </button>
            </>
          ) : null}
          {!dirty && canConfirmStart ? (
            <button
              type="button"
              className={buttonClassName({ variant: 'primary' })}
              disabled={busy}
              onClick={() => onChoice('confirm-start')}
            >
              确认按当前配置开始
            </button>
          ) : null}
        </div>
      )}
    >
      <div className="space-y-3 text-sm text-gray-700">
        {pendingProposalCount > 0 ? (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 font-medium text-red-900" role="alert">
            当前还有 {pendingProposalCount} 个待处理提案；继续生成不会应用这些提案。
          </p>
        ) : null}
        {dirty ? (
          <>
            <p>检测到未发布的本地修改，不会因为点击“开始生成”而静默覆盖房间，也不能用看不见的房间配置开始生成。</p>
            <ul className="list-disc space-y-1 pl-5">
              {reasons.map((reason) => <li key={reason}>{reasonText[reason]}</li>)}
            </ul>
            <p className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900" role="status">
              选择“同步房间配置”会把房间当前配置物化到编辑区（放弃上方列出的未发布本地修改）；完成后再点击一次开始生成。
            </p>
            {!canPublish ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" role="status">
                当前本地编辑草稿无法安全发布；请选择同步房间配置，或取消后修正编辑内容。
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </BaseModal>
  );
}
