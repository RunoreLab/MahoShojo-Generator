// components/MagicalGirlCard.tsx
import React, { useRef, useState } from 'react';
import { snapdom } from '@zumer/snapdom';
import { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState, CurrentStateField } from '@/types/arena';

const formatCurrentStateValue = (field: CurrentStateField) => {
  if (field.type === 'boolean') {
    return field.value ? '是' : '否';
  }
  if (field.type === 'number') {
    return typeof field.value === 'number' ? field.value : Number(field.value) || 0;
  }
  return String(field.value ?? '');
};

const renderCurrentStatePanel = (state?: CharacterCurrentState | null) => {
  if (!state) return null;
  const hasSummary = Boolean(state.summary && state.summary.trim());
  const fields = Array.isArray(state.fields) ? state.fields : [];
  const hasFields = fields.length > 0;
  if (!hasSummary && !hasFields) return null;

  return (
    <div className="result-item">
      <div className="result-label">🧭 当前状态</div>
      <div className="result-value text-sm space-y-2">
        {hasSummary && <p className="leading-relaxed">{state.summary}</p>}
        {hasFields && (
          <ul className="text-xs space-y-1">
            {fields.map(field => (
              <li key={field.id} className="flex justify-between gap-2">
                <span className="font-semibold text-gray-700">{field.label}</span>
                <span className="text-gray-900">{formatCurrentStateValue(field)}</span>
              </li>
            ))}
          </ul>
        )}
        {state.updated_at && (
          <p className="text-[10px] text-gray-400">最近更新：{new Date(state.updated_at).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
};

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
  saveButtonLabel
}) => {
  const resultRef = useRef<HTMLDivElement>(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  /**
   * 对卡片内容进行截图，并根据 imageSaveMode 选择保存策略。
   * - auto：自动检测终端类型，移动端触发回调弹窗，桌面端直接下载。
   * - modal：始终调用 onSaveImage，由父组件控制后续交互。
   * - download：始终触发本地下载。
   */
  const handleSaveImage = async () => {
    if (!resultRef.current) return;

    try {
      // 截图前隐藏按钮和显示Logo
      const saveButton = resultRef.current.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = resultRef.current.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(resultRef.current, {
        scale: 1,
      });

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
        const sanitizedTitle = magicalGirl.codename.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
        downloadLink.download = `魔法少女_${sanitizedTitle}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error("Image generation failed:", err);
      // 确保在出错时也恢复按钮
      const saveButton = resultRef.current?.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = resultRef.current?.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
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

        {/* 基本信息 */}
        <div className="result-item">
          <div className="result-label">💝 魔法少女代号</div>
          <div className="result-value">{magicalGirl.codename}</div>
        </div>

        {/* 外观描述 */}
        <div className="result-item">
          <div className="result-label">👗 魔法少女外观</div>
          <div className="result-value">
            <div><strong>服装：</strong>{magicalGirl.appearance.outfit}</div>
            <div><strong>饰品：</strong>{magicalGirl.appearance.accessories}</div>
            <div><strong>配色：</strong>{magicalGirl.appearance.colorScheme}</div>
            <div><strong>整体风格：</strong>{magicalGirl.appearance.overallLook}</div>
          </div>
        </div>

        {/* 魔力构装 */}
        <div className="result-item">
          <div className="result-label">⚔️ 魔力构装</div>
          <div className="result-value">
            <div><strong>名称：</strong>{magicalGirl.magicConstruct.name}</div>
            <div><strong>形态：</strong>{renderComplexValue(magicalGirl.magicConstruct.form)}</div>
            <div><strong>基本能力：</strong></div>
            {Array.isArray(magicalGirl.magicConstruct.basicAbilities) ? (
              <ul style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
                {magicalGirl.magicConstruct.basicAbilities.map((ability, index) => renderAbilityItem(ability, index))}
              </ul>
            ) : (
              <p className="text-sm" style={{ marginLeft: '0.5rem', marginTop: '0.5rem' }}>
                {renderInlineValue(magicalGirl.magicConstruct.basicAbilities)}
              </p>
            )}
            <div style={{ marginTop: '0.5rem' }}><strong>详细描述：</strong>{magicalGirl.magicConstruct.description}</div>
          </div>
        </div>

        {/* 奇境规则 */}
        <div className="result-item">
          <div className="result-label">🌟 奇境规则</div>
          <div className="result-value">
            <div><strong>规则名称：</strong>{magicalGirl.wonderlandRule.name}</div>
            <div><strong>规则描述：</strong>{magicalGirl.wonderlandRule.description}</div>
            <div><strong>规则倾向：</strong>{magicalGirl.wonderlandRule.tendency}</div>
            <div><strong>激活条件：</strong>{magicalGirl.wonderlandRule.activation}</div>
          </div>
        </div>

        {/* 繁开状态 */}
        <div className="result-item">
          <div className="result-label">🌸 繁开状态</div>
          <div className="result-value">
            <div><strong>繁开名：</strong>{renderComplexValue(magicalGirl.blooming.name)}</div>
            <div><strong>进化能力：</strong></div>
            <ul style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
              {/*如果 magicalGirl.blooming.evolvedAbilities 是字符串，.map() 会抛出 TypeError。
                因此，在使用 .map() 前进行 Array.isArray() 检查，确保代码的鲁棒性。
              */}
              {Array.isArray(magicalGirl.blooming.evolvedAbilities) && magicalGirl.blooming.evolvedAbilities.map((ability: string, index: number) => (
                <li key={index}>• {ability}</li>
              ))}
            </ul>
            <div><strong>进化形态：</strong>{renderComplexValue(magicalGirl.blooming.evolvedForm)}</div>
            <div><strong>进化衣装：</strong>{magicalGirl.blooming.evolvedOutfit}</div>
            <div><strong>力量等级：</strong>{magicalGirl.blooming.powerLevel}</div>
          </div>
        </div>

        {/* 性格分析 */}
        <div className="result-item">
          <div className="result-label">🔮 性格分析</div>
          <div className="result-value">
            <div><strong>性格分析：</strong>{magicalGirl.analysis.personalityAnalysis}</div>
            <div><strong>能力推理：</strong>{magicalGirl.analysis.abilityReasoning}</div>
            <div><strong>核心特征：</strong>
              {/* 使用三元运算符进行判断。如果是数组，则正常 join；如果不是，则直接显示该字符串或不显示，避免错误。
              */}
              {Array.isArray(magicalGirl.analysis.coreTraits) 
                ? magicalGirl.analysis.coreTraits.join('、') 
                : magicalGirl.analysis.coreTraits}
            </div>
            <div><strong>预测依据：</strong>{magicalGirl.analysis.predictionBasis}</div>
          </div>
        </div>

        {/* 角色背景 */}
        {magicalGirl.analysis.background && (
          <div className="result-item">
            <div className="result-label">📖 角色背景</div>
            <div className="result-value">
              <div><strong>信念：</strong>{magicalGirl.analysis.background.belief}</div>
              <div style={{ marginTop: '0.5rem' }}><strong>羁绊：</strong>{magicalGirl.analysis.background.bonds}</div>
            </div>
          </div>
        )}

        {renderCurrentStatePanel(magicalGirl.current_state)}

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
                      <p><strong>影响:</strong> {entry.impact}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button onClick={handleSaveImage} className="save-button">
          {saveButtonLabel ?? '📱 保存为图片'}
        </button>

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

export default MagicalGirlCard;
