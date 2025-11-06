import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ArenaHistory, ArenaHistoryEntry } from '@/types/arena';
import { GeneralCharacterData } from '@/lib/schemas/general-character';

interface GeneralCharacterCardProps {
  general: (GeneralCharacterData & { arena_history?: ArenaHistory | null }) | { name: string; content: string; arena_history?: ArenaHistory | null };
}

const GeneralCharacterCard: React.FC<GeneralCharacterCardProps> = ({ general }) => {
  const renderHistory = () => {
    const history = general?.arena_history;
    if (!history || !Array.isArray(history.entries) || history.entries.length === 0) {
      return null;
    }

    const entries = [...history.entries].reverse();

    return (
      <div className="result-item">
        <div className="result-label">🧭 历战记录</div>
        <div className="result-value space-y-3">
          {entries.map((entry: ArenaHistoryEntry) => (
            <div key={entry.id} className="rounded-lg border border-purple-200 bg-white/70 p-3 shadow-sm">
              <div className="flex justify-between text-xs text-purple-600 mb-1">
                <span>{entry.type === 'sublimation' ? '升华事件' : entry.type}</span>
                <span>胜者：{entry.winner || '未知'}</span>
              </div>
              <div className="text-sm font-semibold text-gray-800 mb-1">{entry.title || '未命名事件'}</div>
              <div className="text-sm text-gray-600 leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>{entry.impact || '暂无影响描述'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="result-card" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #312e81 100%)' }}>
      <div className="result-content">
        <div className="flex justify-center items-center mb-6">
          <img src="/sublimation.svg" width={260} height={80} alt="通用角色" />
        </div>

        <div className="result-item">
          <div className="result-label">🌌 角色名称</div>
          <div className="result-value text-2xl font-bold text-white drop-shadow" style={{ letterSpacing: '0.06em' }}>
            {general?.name || '未命名角色'}
          </div>
        </div>

        <div className="result-item">
          <div className="result-label">📜 角色设定（content）</div>
          <div className="result-value bg-white/90 rounded-xl p-4 shadow-inner text-sm leading-relaxed text-gray-800">
            <ReactMarkdown
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
                code: ({ children }) => <code className="bg-gray-100 rounded px-1 py-0.5 text-xs text-gray-700">{children}</code>
              }}
            >
              {general?.content?.trim() || '（content 字段为空，建议补充完整的角色设定，包括外观、能力、背景与关键剧情。）'}
            </ReactMarkdown>
          </div>
        </div>

        {renderHistory()}
      </div>
    </div>
  );
};

export default GeneralCharacterCard;
