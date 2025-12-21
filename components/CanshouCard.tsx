// components/CanshouCard.tsx
import React, { useRef, useState } from 'react';
import { snapdom } from '@zumer/snapdom';
import { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState } from '@/types/arena';
import { CurrentStatePanel } from '@/components/CurrentStatePanel';
import { MarkdownBlock } from '@/components/MarkdownBlock';

export interface CanshouDetails {
  name: string;
  coreConcept: string;
  coreEmotion: string;
  evolutionStage: string;
  appearance: string;
  materialAndSkin: string;
  featuresAndAppendages: string;
  attackMethod: string;
  specialAbility: string;
  origin: string;
  birthEnvironment: string;
  researcherNotes: string;
  arena_history?: ArenaHistory;
  current_state?: CharacterCurrentState | null;
}

interface CanshouCardProps {
  canshou: CanshouDetails;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
}

const CanshouCard: React.FC<CanshouCardProps> = ({ canshou, onSaveImage, imageSaveMode = 'auto', saveButtonLabel }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  // 新增：用于控制历战记录可见性的状态
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  /**
   * 截图残兽档案，并根据 imageSaveMode 决定保存方式。
   * auto 根据终端类型在弹窗与直接下载之间切换，其余模式强制执行对应策略。
   */
  const handleSaveImage = async () => {
    if (!cardRef.current) return;

    try {
      // 截图前隐藏按钮和显示Logo
      const saveButton = cardRef.current.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(cardRef.current, { scale: 1 });

      // 截图后恢复按钮和隐藏Logo
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
        const sanitizedTitle = canshou.name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
        downloadLink.download = `残兽档案_${sanitizedTitle}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error("Image generation failed:", err);
      // 确保在出错时也恢复按钮
      const saveButton = cardRef.current?.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = cardRef.current?.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    }
  };

  return (
    <div ref={cardRef} className="result-card" style={{ background: 'linear-gradient(135deg, #434343 0%, #000000 100%)' }}>
      <div className="result-content">
        <div className="flex justify-center">
          <img
            src="/beast-title.svg"
            alt="残兽档案"
            className="w-72 mb-4"
          />
        </div>

        <div className="result-item">
          <div className="result-label">名称</div>
          <div className="result-value">{canshou.name}</div>
        </div>

        <div className="flex">
        <div className="result-item w-full mr-4">
          <div className="result-label">核心概念</div>
          <div className="result-value text-sm">
            <MarkdownBlock content={canshou.coreConcept} variant="dark" />
          </div>
        </div>
        <div className="result-item w-full">
          <div className="result-label">核心情感/欲望</div>
          <div className="result-value text-sm">
            <MarkdownBlock content={canshou.coreEmotion} variant="dark" />
          </div>
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">进化阶段</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.evolutionStage} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">外貌描述</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.appearance} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">材质/表皮</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.materialAndSkin} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">特征/附属物</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.featuresAndAppendages} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">攻击方式</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.attackMethod} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">特殊能力</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.specialAbility} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">起源</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.origin} variant="dark" />
        </div>
      </div>

      <div className="result-item">
        <div className="result-label">诞生环境</div>
        <div className="result-value text-sm">
          <MarkdownBlock content={canshou.birthEnvironment} variant="dark" />
        </div>
      </div>

      <div className="result-item border-l-4 border-red-400">
        <div className="result-label">研究员笔记</div>
        <div className="result-value text-sm italic">
          <MarkdownBlock content={canshou.researcherNotes} variant="dark" />
        </div>
      </div>
        
        <CurrentStatePanel state={canshou.current_state} variant="dark" />

        {/*
          【修复】对历战记录进行健壮性检查。
          修改后：在尝试访问 .entries 之前，先确保 canshou.arena_history 和 canshou.arena_history.entries 都存在且为数组。
          这样可以防止因数据格式不规范（如 arena_history 为 null 或 entries 不是数组）导致的页面崩溃。
        */}
        {canshou.arena_history && Array.isArray(canshou.arena_history.entries) && canshou.arena_history.entries.length > 0 && (
          <div className="result-item">
            <button onClick={() => setIsHistoryVisible(!isHistoryVisible)} className="result-label w-full text-left bg-transparent border-none cursor-pointer">
              {isHistoryVisible ? '▼' : '▶'} 📜 历战记录
            </button>
            {isHistoryVisible && (
              <div className="result-value mt-2 space-y-2 text-xs">
                {canshou.arena_history.entries.slice().reverse().map((entry: ArenaHistoryEntry) => (
                  <div key={entry.id} className="p-2 bg-black bg-opacity-10 rounded">
                    <p><strong>{entry.title}</strong></p>
                    <p><strong>类型:</strong> {entry.type} | <strong>胜利者:</strong> {entry.winner}</p>
                    <div className="mt-1">
                      <p className="font-semibold">影响:</p>
                      <MarkdownBlock content={entry.impact || '暂无影响描述'} variant="dark" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={handleSaveImage} className="save-button mt-4">
          {saveButtonLabel ?? '📱 保存为图片'}
        </button>

        {/* 【核心修改】新增：用于截图的Logo占位符，默认隐藏 */}
        <div className="logo-placeholder" style={{ display: 'none', justifyContent: 'center', marginTop: '1rem' }}>
          <img
            src="/logo-white-qrcode.svg"
            width={280}
            height={280}
            alt="Logo"
            style={{
              display: 'block',
              maxWidth: '100%',
              height: 'auto'
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CanshouCard;
