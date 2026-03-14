'use client';

import { useMemo, useState } from 'react';

import BattleReportCard, { type NewsReport } from '@/components/BattleReportCard';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { BaseModal } from '@/components/shared/BaseModal';
import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';

export const shouldUseStreamingBattleReportCard = (input: {
  generationMode?: string | null;
  liveBody?: string | null;
}): boolean => {
  return input.generationMode === 'stream' && typeof input.liveBody === 'string' && Boolean(input.liveBody.trim());
};

type Props = {
  isOpen: boolean;
  generationId?: string | null;
  generationMode?: string | null;
  report: NewsReport | null;
  liveBody?: string | null;
  onClose: () => void;
};

export function BattleReportCardModal({ isOpen, generationId, generationMode, report, liveBody, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  const mode = useMemo(() => {
    const raw = (report as any)?.mode;
    if (raw === 'classic' || raw === 'kizuna' || raw === 'daily' || raw === 'scenario') return raw;
    return undefined;
  }, [report]);

  const normalizedLiveBody = typeof liveBody === 'string' && liveBody.trim() ? liveBody : null;
  const useStreamingCard = shouldUseStreamingBattleReportCard({
    generationMode,
    liveBody: normalizedLiveBody,
  });

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
          useStreamingCard && normalizedLiveBody ? (
            <StreamingBattleReportCard
              content={normalizedLiveBody}
              onSaveImage={(url) => {
                setImageUrl(url);
                setShowImageModal(true);
              }}
              mode={mode}
              scenarioName={typeof report.scenario === 'string' ? report.scenario : undefined}
              reporterInfo={report.reporterInfo}
              userGuidance={report.userGuidance ?? null}
              characterGuidances={report.characterGuidances ?? null}
              adjudicationResults={report.adjudicationResults ?? null}
              aiUsage={report.aiUsage ?? null}
              aiModel={report.aiModel ?? null}
              narrativeHistoryReadCount={typeof report.narrativeHistoryReadCount === 'number' ? report.narrativeHistoryReadCount : null}
              aiReasoning={report.aiReasoning ?? null}
              isStreaming={false}
            />
          ) : (
            <BattleReportCard
              report={report}
              mode={mode}
              liveBody={normalizedLiveBody ?? undefined}
              onSaveImage={(url) => {
                setImageUrl(url);
                setShowImageModal(true);
              }}
            />
          )
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
