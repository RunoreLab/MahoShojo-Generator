import React, { useMemo, useRef } from 'react';
import { snapdom } from '@zumer/snapdom';
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

  const displayContent =
    scenario?.content?.trim()
      ? scenario.content.trim()
      : isStreaming
        ? '正在启动流式生成…'
        : '（content 字段为空，建议补充完整的情景设定，包括背景、事件、氛围。）';

  const gradientStyle = useMemo(() => 'linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%)', []);

  const handleSaveImage = async () => {
    if (isStreaming) return;
    if (!cardRef.current) return;

    try {
      const saveButton = cardRef.current.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(cardRef.current, { scale: 1, useProxy: getSnapdomProxyUrl() });

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
    <div
      ref={cardRef}
      className="result-card"
      style={{ background: gradientStyle }}
    >
      <div className="result-content">
        <div className="flex justify-center">
          <img src="/scenario-mode.svg" alt="通用情景档案" className="w-72 mb-4" />
        </div>

        <div className="result-item">
          <div className="result-label">情景名称</div>
          <div className="result-value text-2xl font-bold text-white drop-shadow" style={{ letterSpacing: '0.08em' }}>
            {scenario?.title || '未命名情景'}
          </div>
        </div>

        <div className="result-item">
          <div className="result-label">情景设定</div>
          <div className="result-value text-sm">
            <MarkdownBlock
              content={displayContent}
              variant="dark"
              mode="article"
            />
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-white/70 animate-pulse align-middle ml-1" />
            )}
          </div>
        </div>

        <button onClick={handleSaveImage} className="save-button mt-4" disabled={isStreaming}>
          {isStreaming ? '生成中...' : (saveButtonLabel ?? '📱 保存为图片')}
        </button>

        <div
          className="logo-placeholder"
          style={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}
        >
          <img
            src="/logo-white-qrcode.svg"
            alt="魔法少女"
            className="w-32 opacity-80"
          />
        </div>
      </div>
    </div>
  );
};

export default GeneralScenarioCard;
