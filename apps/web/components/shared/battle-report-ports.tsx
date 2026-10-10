import type { BattleReportHostPorts } from '@mahoshojo/ui-web/arena-report';
import { GeneratedByUserBadge } from './GeneratedByUserBadge';
import { webExternalMediaPolicy } from '@/lib/markdown/externalMedia';
import { extractHeuristicReasoningFromMarkdown } from '@/lib/ai/reasoning-normalizer';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';

/** Web-only auth badge, media policy, screenshot and download/share behaviour. */
export function createWebBattleReportPorts(onSaveImage?: (imageUrl: string) => void): BattleReportHostPorts {
  return {
    mediaPolicy: webExternalMediaPolicy,
    extractReasoning: extractHeuristicReasoningFromMarkdown,
    generatedBy: <GeneratedByUserBadge variant="dark" className="mt-3" />,
    downloadMarkdown: (content, filename) => downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8;' }), filename),
    onImageSaveError: (error) => { alert('生成图片失败，请重试'); console.error('Image generation failed:', error); },
    saveImage: async (element, { filename, title, kind }) => {
      const blob = await capturePngBlob(element, { scale: 1, dprMax: 2, fast: false, exclude: ['audio', 'video'], excludeMode: 'remove' });
      if (/Mobi/i.test(window.navigator.userAgent)) {
        if (kind === 'streaming') {
          const canShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator;
          if (canShare && typeof File !== 'undefined') {
            try {
              const file = new File([blob], filename, { type: 'image/png' });
              const shareData: ShareData = { files: [file], title };
              if (navigator.canShare(shareData)) { await navigator.share({ files: [file], title }); return; }
            } catch (shareError) { console.warn('图片分享失败，将回退到长按保存弹窗', shareError); }
          }
        }
        if (onSaveImage) onSaveImage(createBlobUrl(blob));
      } else { downloadBlob(blob, filename); }
    },
  };
}
