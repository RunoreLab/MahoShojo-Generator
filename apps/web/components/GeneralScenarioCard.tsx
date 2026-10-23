import React, { useRef } from 'react';
import { snapdom } from '@zumer/snapdom';
import { GeneralScenarioCard as SharedGeneralScenarioCard } from '@mahoshojo/ui-web/scenario';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { getSnapdomProxyUrl } from '@/lib/client/snapdomCapture';

interface GeneralScenarioCardProps {
  scenario: {
    title: string;
    content: string;
  };
  isStreaming?: boolean;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
}

const GeneralScenarioCard: React.FC<GeneralScenarioCardProps> = ({
  scenario,
  isStreaming = false,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleSaveImage = async () => {
    if (isStreaming) return;
    if (!cardRef.current) return;

    try {
      const saveButton = cardRef.current.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(cardRef.current, {
        scale: 1,
        useProxy: getSnapdomProxyUrl(),
        exclude: ['[data-scenario-preview-controls]'],
        excludeMode: 'remove',
      });

      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';

      const imgElement = await result.toPng();
      const imageUrl = imgElement.src;

      const resolvedMode: 'modal' | 'download' = imageSaveMode === 'modal' || imageSaveMode === 'download'
        ? imageSaveMode
        : (/Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download');

      if (resolvedMode === 'modal') {
        if (onSaveImage) {
          onSaveImage(imageUrl);
        } else {
          const previewWindow = window.open(imageUrl, '_blank');
          if (!previewWindow) {
            alert('图片已生成，请长按或右键保存。');
          }
        }
      } else {
        const downloadLink = document.createElement('a');
        downloadLink.href = imageUrl;
        const sanitizedTitle = (scenario?.title || '未命名情景').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
        downloadLink.download = `通用情景_${sanitizedTitle}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error('Image generation failed:', err);
      const saveButton = cardRef.current?.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = cardRef.current?.querySelector('.logo-placeholder') as HTMLElement;
      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    }
  };

  return (
    <SharedGeneralScenarioCard
      scenario={scenario}
      isStreaming={isStreaming}
      cardRef={cardRef}
      renderMarkdown={(content) => <MarkdownBlock content={content} variant="dark" mode="article" />}
      saveButton={(
        <button onClick={handleSaveImage} className="save-button mt-4" disabled={isStreaming}>
          {isStreaming ? '生成中...' : (saveButtonLabel ?? '📱 保存为图片')}
        </button>
      )}
    />
  );
};

export default GeneralScenarioCard;
