// components/CanshouCard.tsx
import React, { useRef, useState } from 'react';
import { snapdom } from '@zumer/snapdom';
import { ArenaHistory, ArenaHistoryEntry } from '@/types/arena';

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
}

interface CanshouCardProps {
  canshou: CanshouDetails;
  onSaveImage: (imageUrl: string) => void;
}

const CanshouCard: React.FC<CanshouCardProps> = ({ canshou, onSaveImage }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  // 新增：用于控制历战记录可见性的状态
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  /**
   * 【核心修改】
   * 替换原有的 handleSaveImage 函数。
   * 新的函数包含了与 BattleReportCard 相同的逻辑：
   * 1. 在截图时隐藏按钮，显示 Logo。
   * 2. 区分移动端和桌面端设备。
   * - 移动端：调用 onSaveImage 回调，由父组件弹出图片模态框供用户长按保存。
   * - 桌面端：直接触发 PNG 文件的下载。
   * 3. 提供了更完善的错误处理，确保在失败时也能恢复UI。
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

      // 检测设备类型以提供最佳保存体验
      const isMobileDevice = /Mobi/i.test(window.navigator.userAgent);

      if (isMobileDevice) {
        // 在移动端，调用回调函数以显示弹窗供用户长按保存
        if (onSaveImage) {
          onSaveImage(imageUrl);
        }
      } else {
        // 在桌面端，直接触发文件下载
        const downloadLink = document.createElement('a');
        downloadLink.href = imageUrl;
        // 使用名称并清理特殊字符作为文件名
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
            <div className="result-value">{canshou.coreConcept}</div>
          </div>
          <div className="result-item w-full">
            <div className="result-label">核心情感/欲望</div>
            <div className="result-value">{canshou.coreEmotion}</div>
          </div>
        </div>

        <div className="result-item">
          <div className="result-label">进化阶段</div>
          <div className="result-value">{canshou.evolutionStage}</div>
        </div>

        <div className="result-item">
          <div className="result-label">外貌描述</div>
          <div className="result-value text-sm">{canshou.appearance}</div>
        </div>

        <div className="result-item">
          <div className="result-label">材质/表皮</div>
          <div className="result-value text-sm">{canshou.materialAndSkin}</div>
        </div>

        <div className="result-item">
          <div className="result-label">特征/附属物</div>
          <div className="result-value text-sm">{canshou.featuresAndAppendages}</div>
        </div>

        <div className="result-item">
          <div className="result-label">攻击方式</div>
          <div className="result-value text-sm">{canshou.attackMethod}</div>
        </div>

        <div className="result-item">
          <div className="result-label">特殊能力</div>
          <div className="result-value text-sm">{canshou.specialAbility}</div>
        </div>

        <div className="result-item">
          <div className="result-label">起源</div>
          <div className="result-value text-sm">{canshou.origin}</div>
        </div>

        <div className="result-item">
          <div className="result-label">诞生环境</div>
          <div className="result-value text-sm">{canshou.birthEnvironment}</div>
        </div>

        <div className="result-item border-l-4 border-red-400">
          <div className="result-label">研究员笔记</div>
          <div className="result-value text-sm italic">{canshou.researcherNotes}</div>
        </div>
        
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
                    <p><strong>影响:</strong> {entry.impact}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={handleSaveImage} className="save-button mt-4">
          📱 保存为图片
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
