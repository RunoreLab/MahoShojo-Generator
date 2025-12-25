'use client';

import { useMemo, useState } from 'react';

import BattleReportCard, { type NewsReport } from '@/components/BattleReportCard';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { BaseModal } from '@/components/shared/BaseModal';

type Props = {
  isOpen: boolean;
  generationId?: string | null;
  report: NewsReport | null;
  onClose: () => void;
};

export function BattleReportCardModal({ isOpen, generationId, report, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  const mode = useMemo(() => {
    const raw = (report as any)?.mode;
    if (raw === 'classic' || raw === 'kizuna' || raw === 'daily' || raw === 'scenario') return raw;
    return undefined;
  }, [report]);

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="战报卡片"
        description={generationId ? `generationId：${generationId}` : undefined}
        maxWidthClassName="max-w-[1100px]"
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
        {report ? (
          <BattleReportCard
            report={report}
            mode={mode}
            onSaveImage={(url) => {
              setImageUrl(url);
              setShowImageModal(true);
            }}
          />
        ) : (
          <div className="text-sm text-gray-600">暂无战报数据。</div>
        )}
      </BaseModal>

      <ImagePreviewModal
        isOpen={showImageModal}
        imageUrl={imageUrl}
        onClose={() => setShowImageModal(false)}
      />
    </>
  );
}

