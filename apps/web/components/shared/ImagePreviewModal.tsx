'use client';

import { useEffect } from 'react';

import { BaseModal } from '@/components/shared/BaseModal';
import { revokeBlobUrl } from '@/lib/client/blobUrl';

type Props = {
  isOpen: boolean;
  imageUrl: string | null;
  onClose: () => void;
};

export function ImagePreviewModal({ isOpen, imageUrl, onClose }: Props) {
  useEffect(() => {
    return () => revokeBlobUrl(imageUrl);
  }, [imageUrl]);

  if (!isOpen) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="保存图片"
      description="移动端可长按图片保存；桌面端可右键另存为。"
      maxWidthClassName="max-w-3xl"
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            关闭
          </button>
        </div>
      }
    >
      {imageUrl ? (
        <div className="flex justify-center">
          <img src={imageUrl} alt="战报卡片" className="max-h-[70vh] w-auto rounded-lg border bg-white" />
        </div>
      ) : (
        <div className="text-sm text-gray-600">暂无图片。</div>
      )}
    </BaseModal>
  );
}

