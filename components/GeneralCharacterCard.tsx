import React, { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { snapdom } from '@zumer/snapdom';
import { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState, CurrentStateField } from '@/types/arena';
import { GeneralCharacterData } from '@/lib/schemas/general-character';
import remarkBattleTable from '@/lib/markdown/remarkBattleTable';

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

export interface GeneralCharacterDetails extends GeneralCharacterData {
  arena_history?: ArenaHistory | null;
}

interface GeneralCharacterCardProps {
  general: GeneralCharacterDetails | {
    name: string;
    content: string;
    arena_history?: ArenaHistory | null;
    current_state?: CharacterCurrentState | null;
  };
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
}

type MainColorKey = 'Red' | 'Orange' | 'Cyan' | 'Blue' | 'Purple' | 'Pink' | 'Yellow' | 'Green';

const MAIN_COLORS: Record<MainColorKey, string> = {
  Red: '红色',
  Orange: '橙色',
  Cyan: '青色',
  Blue: '蓝色',
  Purple: '紫色',
  Pink: '粉色',
  Yellow: '黄色',
  Green: '绿色',
};

const COLOR_GRADIENTS: Record<MainColorKey, { first: string; second: string }> = {
  Red: { first: '#ff6b6b', second: '#ee5a6f' },
  Orange: { first: '#ff922b', second: '#ffa94d' },
  Cyan: { first: '#22b8cf', second: '#66d9e8' },
  Blue: { first: '#5c7cfa', second: '#748ffc' },
  Purple: { first: '#9775fa', second: '#b197fc' },
  Pink: { first: '#ff9a9e', second: '#fecfef' },
  Yellow: { first: '#f59f00', second: '#fcc419' },
  Green: { first: '#51cf66', second: '#8ce99a' },
};

const ENGLISH_COLOR_KEYWORDS: Record<string, MainColorKey> = {
  red: 'Red',
  crimson: 'Red',
  scarlet: 'Red',
  orange: 'Orange',
  amber: 'Orange',
  cyan: 'Cyan',
  teal: 'Cyan',
  blue: 'Blue',
  navy: 'Blue',
  violet: 'Purple',
  purple: 'Purple',
  pink: 'Pink',
  rose: 'Pink',
  yellow: 'Yellow',
  gold: 'Yellow',
  green: 'Green',
  emerald: 'Green',
};

const detectColorFromContent = (content?: string): MainColorKey => {
  if (!content) return 'Pink';
  for (const [key, label] of Object.entries(MAIN_COLORS) as [MainColorKey, string][]) {
    if (content.includes(label)) {
      return key;
    }
  }

  const lower = content.toLowerCase();
  for (const [keyword, color] of Object.entries(ENGLISH_COLOR_KEYWORDS)) {
    if (lower.includes(keyword)) {
      return color;
    }
  }

  return 'Pink';
};

const GeneralCharacterCard: React.FC<GeneralCharacterCardProps> = ({
  general,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);

  const gradientStyle = useMemo(() => {
    const colors = COLOR_GRADIENTS[detectColorFromContent(general?.content)];
    return `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
  }, [general]);

  const handleSaveImage = async () => {
    if (!cardRef.current) return;

    try {
      const saveButton = cardRef.current.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(cardRef.current, { scale: 1 });

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
        const sanitizedTitle = (general?.name || '未命名角色').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
        downloadLink.download = `通用角色_${sanitizedTitle}.png`;
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

  const renderHistory = () => {
    const history = general?.arena_history;
    if (!history || !Array.isArray(history.entries) || history.entries.length === 0) {
      return null;
    }

    const entries = [...history.entries].reverse();
    return (
      <div className="result-item">
        <button
          onClick={() => setIsHistoryVisible(!isHistoryVisible)}
          className="result-label w-full text-left bg-transparent border-none cursor-pointer"
        >
          {isHistoryVisible ? '▼' : '▶'} 📜 历战记录
        </button>
        {isHistoryVisible && (
          <div className="result-value mt-2 space-y-2 text-xs">
            {entries.map((entry: ArenaHistoryEntry) => (
              <div key={entry.id} className="p-2 bg-black bg-opacity-10 rounded">
                <p className="font-semibold text-sm">{entry.title || '未命名事件'}</p>
                <p className="text-gray-200">
                  <strong>类型:</strong> {entry.type} | <strong>胜者:</strong> {entry.winner || '未知'}
                </p>
                <p className="text-gray-100 leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>{entry.impact || '暂无影响描述'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      className="result-card"
      style={{ background: gradientStyle }}
    >
      <div className="result-content">
        <div className="flex justify-center">
          <img src="/questionnaire-title.svg" alt="通用角色档案" className="w-72 mb-4" />
        </div>

        <div className="result-item">
          <div className="result-label">角色名称</div>
          <div className="result-value text-2xl font-bold text-white drop-shadow" style={{ letterSpacing: '0.08em' }}>
            {general?.name || '未命名角色'}
          </div>
        </div>

        <div className="result-item">
          <div className="result-label">角色设定</div>
          <div className="result-value bg-white/95 rounded-xl p-4 shadow-inner text-sm leading-relaxed text-gray-800">
            <ReactMarkdown
              remarkPlugins={[remarkBattleTable]}
              components={{
                h1: ({ children }) => <h1 className="text-2xl font-bold my-3 text-indigo-700">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold my-3 text-indigo-600">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-semibold my-2 text-indigo-500">{children}</h3>,
                p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                strong: ({ children }) => <strong className="text-indigo-700">{children}</strong>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-indigo-300 pl-4 italic text-gray-600 my-3">{children}</blockquote>
                ),
                code: ({ children }) => <code className="bg-gray-100 rounded px-1 py-0.5 text-xs text-gray-700">{children}</code>,
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="min-w-full border-collapse text-left text-sm">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
                tbody: ({ children }) => <tbody className="divide-y divide-gray-200">{children}</tbody>,
                tr: ({ children }) => <tr className="odd:bg-white even:bg-gray-50/40">{children}</tr>,
                th: ({ children }) => (
                  <th className="px-3 py-2 font-semibold text-gray-700 border-b border-gray-200 whitespace-nowrap">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2 text-gray-800 align-top border-b border-gray-100 whitespace-pre-wrap break-words">
                    {children}
                  </td>
                ),
              }}
            >
              {general?.content?.trim() || '（content 字段为空，建议补充完整的角色设定，包括外观、能力、背景。）'}
            </ReactMarkdown>
          </div>
        </div>

        {renderCurrentStatePanel(general?.current_state)}

        {renderHistory()}

        <button onClick={handleSaveImage} className="save-button mt-4">
          {saveButtonLabel ?? '📱 保存为图片'}
        </button>

        <div className="logo-placeholder" style={{ display: 'none', justifyContent: 'center', marginTop: '1rem' }}>
          <img
            src="/logo-white-qrcode.svg"
            width={240}
            height={240}
            alt="MahoShojo Generator"
            style={{
              display: 'block',
              borderRadius: '12px',
              background: 'rgba(17, 24, 39, 0.85)',
              padding: '1rem',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default GeneralCharacterCard;
