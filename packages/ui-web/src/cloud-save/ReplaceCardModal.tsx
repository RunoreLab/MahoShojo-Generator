import type { ReactNode } from 'react';
import { BaseModal } from '../modal/BaseModal';

export interface ReplaceCardModalTarget {
  name: string;
  type: string;
  isPublic: number | boolean;
  reviewStatus?: string;
  hasPendingUpdate?: boolean;
}
export interface ReplaceCardModalProps {
  isOpen: boolean;
  target: ReplaceCardModalTarget | null;
  onClose: () => void;
  onConfirm: () => void;
  isSaving?: boolean;
  submitDisabled?: boolean;
  error?: string | null;
  supplementaryContent?: ReactNode;
}

/** 两端相同的确认界面；账号、正文与服务端版本快照由宿主绑定，确认不自动重试。 */
export function ReplaceCardModal({ isOpen, target, onClose, onConfirm, isSaving = false, submitDisabled = false, error, supplementaryContent }: ReplaceCardModalProps) {
  const close = () => { if (!isSaving) onClose(); };
  return <BaseModal isOpen={isOpen && target !== null} title="替换数据卡" onClose={close} maxWidthClassName="max-w-md" closeOnBackdrop={!isSaving}>
    <div className="space-y-4 text-sm">
      <p>确认用当前编辑内容替换「{target?.name}」吗？</p>
      <p className="text-gray-600">保留目标卡片的名称、描述、公开状态和 ID。当前编辑内容及本地库保持不变。</p>
      {target?.hasPendingUpdate && <p className="rounded border border-yellow-200 bg-yellow-50 p-3 text-yellow-800">这张卡已有待审核版本，请确认当前编辑内容是否为你希望提交的版本。</p>}
      <p className="text-gray-600">本次替换可能需要审核；是否立即生效、是否更新待审版本，以服务器确认结果为准。</p>
      {error && <p role="alert" className="rounded bg-red-100 p-3 text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="generate-button flex-1" disabled={isSaving || submitDisabled || target === null} onClick={onConfirm}>{isSaving ? '替换中...' : '确认替换'}</button>
        <button type="button" className="generate-button flex-1 bg-white/80 text-gray-600 border-2 border-gray-200 hover:bg-white" disabled={isSaving} onClick={close}>取消</button>
      </div>
      {supplementaryContent}
    </div>
  </BaseModal>;
}
