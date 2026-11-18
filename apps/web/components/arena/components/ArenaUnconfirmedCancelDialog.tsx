'use client';

import { RotateCw } from 'lucide-react';

import { BaseModal } from '@/components/shared/BaseModal';
import { buttonClassName } from '@/components/shared/ui/Button';

type Props = Readonly<{
  isOpen: boolean;
  connectionState: 'cancelling' | 'cancel_unconfirmed' | null;
  isCooldown: boolean;
  remainingTime: number;
  isGenerating: boolean;
  onConfirm: () => void;
  onClose: () => void;
}>;

export function ArenaUnconfirmedCancelDialog({
  isOpen,
  connectionState,
  isCooldown,
  remainingTime,
  isGenerating,
  onConfirm,
  onClose,
}: Props) {
  const isCancelling = connectionState === 'cancelling';

  return (
    <BaseModal
      isOpen={isOpen}
      title="确认是否重新生成"
      description={
        isCancelling
          ? '上一次停止请求仍在等待服务器确认。'
          : '未能确认服务器已停止上一次生成。'
      }
      maxWidthClassName="max-w-lg"
      onClose={onClose}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            className={buttonClassName()}
            onClick={onClose}
          >
            暂不生成
          </button>
          <button
            type="button"
            className={buttonClassName({ variant: 'primary' })}
            disabled={isCooldown || isGenerating}
            onClick={onConfirm}
          >
            <RotateCw className="mr-1.5 inline-block h-4 w-4" aria-hidden="true" />
            确认风险并重新生成
          </button>
        </div>
      )}
    >
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
        <p>
          {isCancelling
            ? '我们已本地停止接收上一场战报，但服务器尚未返回最终停止确认。'
            : '由于超时、网络异常或状态暂未确认，上一场战报可能仍在服务器后台继续生成。'}
        </p>
        <p
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100"
          role="status"
        >
          如果现在确认风险并重新生成，系统会发起全新的生成任务；上一场生成若仍在后台运行，仍可能消耗额度或产生费用，但不会覆盖你当前的新战报结果。
        </p>
        {isCooldown ? (
          <p
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100"
            role="status"
          >
            生成通道冷却中，还需 {remainingTime} 秒后可确认重新生成。
          </p>
        ) : null}
      </div>
    </BaseModal>
  );
}
