// components/MagicalGirlCard.tsx
import React, { useRef, useState } from 'react';
import { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState } from '@/types/arena';
import { CurrentStatePanel } from '@/components/CurrentStatePanel';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { InlineField } from '@/components/shared/InlineField';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

interface MagicalGirlCardProps {
  magicalGirl: {
    codename: string;
    appearance: {
      outfit: string;
      accessories: string;
      colorScheme: string;
      overallLook: string;
    };
    magicConstruct: {
      name: string;
      form: string | object; // 允许 form 是字符串或对象
      basicAbilities: Array<string | Record<string, unknown>> | string;
      description: string;
    };
    wonderlandRule: {
      name: string;
      description: string;
      tendency: string;
      activation: string;
    };
    blooming: {
      name: string | object; // 允许 name 是字符串或对象
      evolvedAbilities: string[] | string;
      evolvedForm: string;
      evolvedOutfit: string;
      powerLevel: string;
    };
    analysis: {
      personalityAnalysis: string;
      abilityReasoning: string;
      coreTraits: string[] | string;
      predictionBasis: string;
      background?: {
        belief: string;
        bonds: string;
      };
    };
  arena_history?: ArenaHistory;
  current_state?: CharacterCurrentState | null;
  };
  gradientStyle: string;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
  portraitAsset?: CharacterCardPortraitAsset | null;
}

/**
 * 【v0.3.0 修复】辅助渲染函数，用于安全地处理可能是字符串或对象的值。
 * @param value - 需要渲染的值
 * @returns React 节点
 */
const renderComplexValue = (value: any) => {
    // 如果值是字符串，直接返回
    if (typeof value === 'string') {
        return value;
    }
    // 如果值是对象（但不是null或数组），则格式化为键值对列表
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return (
            <div style={{ marginTop: '0.25rem', paddingLeft: '0.5rem' }}>
                {Object.entries(value).map(([key, val]) => (
                    <div key={key}><strong>{key}：</strong>{String(val)}</div>
                ))}
            </div>
        );
    }
    // 对于其他类型（如数字等），转换为字符串
    return String(value);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const renderInlineValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => renderInlineValue(item)).filter(Boolean).join('，');
  }
  if (isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[复杂数据]';
    }
  }
  return String(value);
};

const renderAbilityItem = (ability: string | Record<string, unknown>, index: number) => {
  if (typeof ability === 'string') {
    return <li key={`basicAbility-${index}`}>• {ability}</li>;
  }

  if (isPlainObject(ability)) {
    const { name, description, subFields, ...rest } = ability;
    const hasName = typeof name === 'string' && name.trim().length > 0;
    const hasDescription = typeof description === 'string' && description.trim().length > 0;
    const subFieldEntries = isPlainObject(subFields) ? Object.entries(subFields) : [];
    const extraEntries = Object.entries(rest).filter(([, value]) => value !== undefined && value !== null);
    const hasStructuredInfo = subFieldEntries.length > 0 || extraEntries.length > 0;

    return (
      <li key={`basicAbility-${index}`} style={{ marginBottom: '0.75rem' }}>
        <div>
          <span>• </span>
          {hasName && <strong>{String(name)}</strong>}
          {hasDescription && (
            <span>{hasName ? '：' : ''}{String(description)}</span>
          )}
          {!hasName && !hasDescription && !hasStructuredInfo && (
            <span>{renderInlineValue(ability)}</span>
          )}
        </div>
        {subFieldEntries.length > 0 && (
          <ul style={{ marginLeft: '1.5rem', marginTop: '0.25rem', listStyleType: 'circle' }}>
            {subFieldEntries.map(([subKey, subValue]) => (
              <li
                key={`basicAbility-${index}-sub-${subKey}`}
                style={{ marginLeft: '1rem', listStyleType: 'circle' }}
              >
                <strong>{subKey}：</strong>{renderInlineValue(subValue)}
              </li>
            ))}
          </ul>
        )}
        {extraEntries.length > 0 && (
          <ul style={{ marginLeft: '1.5rem', marginTop: '0.25rem', listStyleType: 'circle' }}>
            {extraEntries.map(([extraKey, extraValue]) => (
              <li
                key={`basicAbility-${index}-extra-${extraKey}`}
                style={{ marginLeft: '1rem', listStyleType: 'circle' }}
              >
                <strong>{extraKey}：</strong>{renderInlineValue(extraValue)}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return <li key={`basicAbility-${index}`}>• {renderInlineValue(ability)}</li>;
};

const MagicalGirlCard: React.FC<MagicalGirlCardProps> = ({
  magicalGirl,
  gradientStyle,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
  portraitAsset = null,
}) => {
  const resultRef = useRef<HTMLDivElement>(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const portraitImageUrl = typeof portraitAsset?.imageUrl === 'string' ? portraitAsset.imageUrl.trim() : '';
  const uploadedPortraitNote =
    portraitAsset?.source === 'uploaded'
      ? (typeof portraitAsset.note === 'string' && portraitAsset.note.trim() ? portraitAsset.note.trim() : '用户自行上传')
      : '';

  /**
   * 对卡片内容进行截图，并根据 imageSaveMode 选择保存策略。
   * - auto：自动检测终端类型，移动端触发回调弹窗，桌面端直接下载。
   * - modal：始终调用 onSaveImage，由父组件控制后续交互。
   * - download：始终触发本地下载。
   */
  const handleSaveImage = async () => {
    if (!resultRef.current) return;
    if (isSavingImage) return;

    const saveButton = resultRef.current.querySelector('.save-button') as HTMLElement;
    const logoPlaceholder = resultRef.current.querySelector('.logo-placeholder') as HTMLElement;
    try {
      setIsSavingImage(true);
      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const blob = await capturePngBlob(resultRef.current, {
        scale: 1,
        dprMax: 2,
        fast: false,
        exclude: ['audio', 'video'],
        excludeMode: 'remove',
      });

      const resolvedMode: 'modal' | 'download' = imageSaveMode === 'modal' || imageSaveMode === 'download'
        ? imageSaveMode
        : (/Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download');
      const sanitizedTitle = magicalGirl.codename.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
      const filename = `魔法少女_${sanitizedTitle}.png`;

      if (resolvedMode === 'modal') {
        const imageUrl = createBlobUrl(blob);
        if (onSaveImage) {
          onSaveImage(imageUrl);
        } else {
          const previewWindow = window.open(imageUrl, '_blank');
          if (!previewWindow) {
            alert('图片已生成，请长按或右键保存。');
          }
        }
      } else {
        downloadBlob(blob, filename);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error("Image generation failed:", err);
    } finally {
      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
      setIsSavingImage(false);
    }
  };

  return (
    <div
      ref={resultRef}
      className="result-card"
      style={{ background: gradientStyle }}
    >
      <div className="result-content">
        <div className="flex justify-center items-center" style={{ marginBottom: '1rem', background: 'transparent' }}>
          <img src="/questionnaire-title.svg" width={300} height={70} alt="Logo" style={{ display: 'block', background: 'transparent' }} />
        </div>

        {portraitImageUrl && (
          <div className="result-item" style={{ borderLeft: '4px solid #f9a8d4', background: 'rgba(0,0,0,0.2)' }}>
            <div className="result-label">🖼️ 角色立绘</div>
            <div className="result-value">
              <img
                src={portraitImageUrl}
                alt={`${magicalGirl.codename || '角色'} 立绘`}
                className="w-full max-h-[560px] object-contain rounded-lg border border-white/15 bg-black/15"
                loading="eager"
                decoding="async"
              />
              {uploadedPortraitNote && (
                <p className="mt-2 text-[11px] text-gray-300 text-right">
                  注：{uploadedPortraitNote}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 基本信息 */}
        <div className="result-item">
          <div className="result-label">💝 魔法少女代号</div>
          <div className="result-value whitespace-pre-wrap break-words">{magicalGirl.codename}</div>
        </div>

        {/* 外观描述 */}
        <div className="result-item">
          <div className="result-label">👗 魔法少女外观</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="space-y-2">
              <InlineField label="服装" content={magicalGirl.appearance.outfit} />
              <InlineField label="饰品" content={magicalGirl.appearance.accessories} />
              <InlineField label="配色" content={magicalGirl.appearance.colorScheme} />
              <InlineField label="整体风格" content={magicalGirl.appearance.overallLook} />
            </div>
          </div>
        </div>

        {/* 魔力构装 */}
        <div className="result-item">
          <div className="result-label">⚔️ 魔力构装</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="space-y-2">
              <InlineField label="名称" content={magicalGirl.magicConstruct.name} />
              <div className="leading-relaxed">
                <span className="font-semibold">形态：</span>
                {renderComplexValue(magicalGirl.magicConstruct.form)}
              </div>
            </div>
            <div className="mt-2"><strong>基本能力：</strong></div>
            {Array.isArray(magicalGirl.magicConstruct.basicAbilities) ? (
              <ul style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
                {magicalGirl.magicConstruct.basicAbilities.map((ability, index) => renderAbilityItem(ability, index))}
              </ul>
            ) : (
              <div className="mt-2 ml-2 text-sm">
                <MarkdownBlock content={renderInlineValue(magicalGirl.magicConstruct.basicAbilities)} variant="dark" />
              </div>
            )}
            <div className="mt-2">
              <InlineField label="详细描述" content={magicalGirl.magicConstruct.description} />
            </div>
          </div>
        </div>

        {/* 奇境规则 */}
        <div className="result-item">
          <div className="result-label">🌟 奇境规则</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="space-y-2">
              <InlineField label="规则名称" content={magicalGirl.wonderlandRule.name} />
              <InlineField label="规则描述" content={magicalGirl.wonderlandRule.description} />
              <InlineField label="规则倾向" content={magicalGirl.wonderlandRule.tendency} />
              <InlineField label="激活条件" content={magicalGirl.wonderlandRule.activation} />
            </div>
          </div>
        </div>

        {/* 繁开状态 */}
        <div className="result-item">
          <div className="result-label">🌸 繁开状态</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="leading-relaxed">
              <span className="font-semibold">繁开名：</span>
              {renderComplexValue(magicalGirl.blooming.name)}
            </div>
            <div className="mt-2"><strong>进化能力：</strong></div>
            <ul style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
              {/*如果 magicalGirl.blooming.evolvedAbilities 是字符串，.map() 会抛出 TypeError。
                因此，在使用 .map() 前进行 Array.isArray() 检查，确保代码的鲁棒性。
              */}
              {Array.isArray(magicalGirl.blooming.evolvedAbilities) && magicalGirl.blooming.evolvedAbilities.map((ability: string, index: number) => (
                <li key={index}>• {ability}</li>
              ))}
            </ul>
            <div className="mt-2 space-y-2">
              {typeof magicalGirl.blooming.evolvedForm === 'string' ? (
                <InlineField label="进化形态" content={magicalGirl.blooming.evolvedForm} />
              ) : (
                <div className="leading-relaxed">
                  <span className="font-semibold">进化形态：</span>
                  {renderComplexValue(magicalGirl.blooming.evolvedForm)}
                </div>
              )}
              <InlineField label="进化衣装" content={magicalGirl.blooming.evolvedOutfit} />
              <InlineField label="力量等级" content={magicalGirl.blooming.powerLevel} />
            </div>
          </div>
        </div>

        {/* 性格分析 */}
        <div className="result-item">
          <div className="result-label">🔮 性格分析</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="space-y-2">
              <InlineField label="性格分析" content={magicalGirl.analysis.personalityAnalysis} />
              <InlineField label="能力推理" content={magicalGirl.analysis.abilityReasoning} />
              <InlineField
                label="核心特征"
                content={
                  Array.isArray(magicalGirl.analysis.coreTraits)
                    ? magicalGirl.analysis.coreTraits.join('、')
                    : String(magicalGirl.analysis.coreTraits ?? '')
                }
              />
              <InlineField label="预测依据" content={magicalGirl.analysis.predictionBasis} />
            </div>
          </div>
        </div>

        {/* 角色背景 */}
        {magicalGirl.analysis.background && (
          <div className="result-item">
            <div className="result-label">📖 角色背景</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="space-y-2">
              <InlineField label="信念" content={magicalGirl.analysis.background.belief} />
              <InlineField label="羁绊" content={magicalGirl.analysis.background.bonds} />
            </div>
          </div>
        </div>
        )}

        <CurrentStatePanel state={magicalGirl.current_state} variant="dark" />

        {/* --- 历战记录展示区 --- */}
        {/*
          【健壮性修复】
          在访问 .entries 之前，增加 Array.isArray() 检查。
          这可以防止因数据格式不规范（如 arena_history 存在但 entries 缺失或不是数组）而导致的页面崩溃。
        */}
        {magicalGirl.arena_history && Array.isArray(magicalGirl.arena_history.entries) && magicalGirl.arena_history.entries.length > 0 && (
          <div className="result-item">
            <button onClick={() => setIsHistoryVisible(!isHistoryVisible)} className="result-label w-full text-left bg-transparent border-none cursor-pointer">
              {isHistoryVisible ? '▼' : '▶'} 📜 历战记录
            </button>
            {isHistoryVisible && (
              <div className="result-value mt-2 space-y-2 text-xs">
                {magicalGirl.arena_history.entries.slice().reverse().map((entry: ArenaHistoryEntry) => {
                  // [UI改进] 从 gradientStyle 中提取起始颜色，用作历战记录条目的背景
                  const startColor = gradientStyle.startsWith('linear-gradient(to right, ')
                    ? gradientStyle.split(', ')[1].trim()
                    : 'rgba(0, 0, 0, 0.05)'; // 默认颜色

                  // 可以根据需要调整透明度或混合模式
                  const historyItemBackground = `${startColor}20`; // 添加一些透明度

                  return (
                    <div key={entry.id} className="p-2 rounded" style={{ backgroundColor: historyItemBackground }}>
                      <p><strong>{entry.title}</strong></p>
                      <p><strong>类型:</strong> {entry.type} | <strong>胜利者:</strong> {entry.winner}</p>
                      <div className="mt-1">
                        <p className="font-semibold">影响:</p>
                        <MarkdownBlock content={entry.impact || '暂无影响描述'} variant="dark" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button onClick={handleSaveImage} className="save-button" disabled={isSavingImage}>
          {isSavingImage ? '生成中...' : (saveButtonLabel ?? '📱 保存为图片')}
        </button>

        <div
          className="logo-placeholder"
          style={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}
        >
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
          <GeneratedByUserBadge variant="dark" className="mt-3" />
        </div>
      </div>
    </div>
  );
};

export default MagicalGirlCard;
