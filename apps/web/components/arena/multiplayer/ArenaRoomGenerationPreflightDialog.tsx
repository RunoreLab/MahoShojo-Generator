'use client';

import { BaseModal } from '@/components/shared/BaseModal';
import type { ArenaRoomHostWorkspaceDirtyReason } from '@/lib/arena-room/host-workspace';

export type ArenaRoomGenerationPreflightChoice = 'cancel' | 'publish' | 'use-room';

type Props = Readonly<{
  isOpen: boolean;
  reasons: readonly ArenaRoomHostWorkspaceDirtyReason[];
  canUseRoom: boolean;
  busy: boolean;
  onChoice: (choice: ArenaRoomGenerationPreflightChoice) => void;
}>;

const buttonClass = 'rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const reasonText: Readonly<Record<ArenaRoomHostWorkspaceDirtyReason, string>> = {
  'shared-config': '本地编辑与房间权威配置不同。',
  'host-local-content': '本地角色、情景或素材的完整正文已变更。',
  'baseline-missing': '当前页面没有这个房间的 host-local 发布基线。',
};

export function ArenaRoomGenerationPreflightDialog({
  isOpen,
  reasons,
  canUseRoom,
  busy,
  onChoice,
}: Props) {
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
            className={`${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-100`}
            disabled={busy}
            onClick={() => onChoice('cancel')}
          >
            取消
          </button>
          <button
            type="button"
            className={`${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-100`}
            disabled={busy || !canUseRoom}
            onClick={() => onChoice('use-room')}
          >
            按当前房间配置开始
          </button>
          <button
            type="button"
            className={`${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`}
            disabled={busy}
            onClick={() => onChoice('publish')}
          >
            更新房间配置并开始
          </button>
        </div>
      )}
    >
      <div className="space-y-3 text-sm text-gray-700">
        <p>检测到未发布的本地修改，不会因为点击“开始生成”而静默覆盖房间。</p>
        <ul className="list-disc space-y-1 pl-5">
          {reasons.map((reason) => <li key={reason}>{reasonText[reason]}</li>)}
        </ul>
        {!canUseRoom ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" role="status">
            缺少完整的 host-local 基线，无法安全地“按当前房间配置”启动；请显式更新房间或取消。
          </p>
        ) : null}
      </div>
    </BaseModal>
  );
}
