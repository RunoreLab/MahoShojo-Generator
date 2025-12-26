// components/BattleReportCard.tsx

import React, { useRef } from 'react';
import { snapdom } from '@zumer/snapdom';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
// 1. [新增] 导入随机判定结果的类型定义
import { AdjudicationResult } from '@/types/arena';
import remarkBattleTable from '@/lib/markdown/remarkBattleTable';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';

type MarkdownCodeProps = React.ComponentPropsWithoutRef<'code'> & ExtraProps & { inline?: boolean };

export interface NewsReport {
  headline: string;
  scenario?: string;
  reporterInfo: {
    name:string;
    publication: string;
  };
  article: {
    body: string;
    analysis: string;
  };
  officialReport: {
    winner: string;
    conclusion: string;
  };
  /** AI 生成相关的 token 统计（用于战报页展示，可能为空）。 */
  aiUsage?: {
    promptTokens?: number | null;
    reasoningTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    cachedTokens?: number | null;
    [key: string]: unknown;
  };
  /**
   * 读取叙事历史条数：仅在开启 readNarrativeHistory 时由后端写入（未开启则不返回）。
   * 可能为 0（已开启但本地无可用条目）。
   */
  narrativeHistoryReadCount?: number;
  // 可选的用户引导信息字段
  userGuidance?: string;
  mode?: 'classic' | 'kizuna' | 'daily' | 'scenario';
  // 2. [新增] 为战报数据接口增加随机判定结果字段
  adjudicationResults?: AdjudicationResult[];
}

interface BattleReportCardProps {
  report: NewsReport;
  onSaveImage?: (imageUrl: string) => void;
  // 战斗模式，设为可选以兼容旧功能
  mode?: 'classic' | 'kizuna' | 'daily' | 'scenario';
  liveBody?: string;
}

const BattleReportCard: React.FC<BattleReportCardProps> = ({ report, onSaveImage, mode, liveBody }) => {
  const cardRef = useRef<HTMLDivElement>(null);

  const headline = typeof report?.headline === 'string' && report.headline.trim() ? report.headline.trim() : '（无标题）';
  const reporterName = typeof report?.reporterInfo?.name === 'string' ? report.reporterInfo.name : '';
  const reporterPublication = typeof report?.reporterInfo?.publication === 'string' ? report.reporterInfo.publication : '';
  const bodyContent = (liveBody ?? report.article?.body ?? '').trimEnd();
  const analysisContent = (report.article?.analysis ?? '').trimEnd();
  const officialWinner = (report.officialReport?.winner ?? '').trim();
  const officialConclusion = (report.officialReport?.conclusion ?? '').trimEnd();

  const aiUsage = report.aiUsage;
  const hasAnyTokenNumber =
    aiUsage != null &&
    [aiUsage.promptTokens, aiUsage.reasoningTokens, aiUsage.completionTokens].some(
      (value) => typeof value === 'number' && Number.isFinite(value)
    );
  const shouldShowNarrativeReadCount = typeof report.narrativeHistoryReadCount === 'number';

  const getModeDisplay = (mode: string) => {
    switch (mode) {
      case 'daily':
        return { text: '日常模式 ☕', logo: '/daily-mode.svg' };
      case 'kizuna':
        return { text: '羁绊模式 ✨', logo: '/kizuna-mode.svg' };
      case 'classic':
        return { text: '经典模式 ⚔️', logo: '/classic-mode.svg' };
      case 'scenario':
        return { text: '情景模式 📜', logo: '/scenario-mode.svg' };
      default:
        return null;
    }
  };

  const modeDisplay = mode ? getModeDisplay(mode) : null;
  const showScenarioTitle = mode === 'scenario' && typeof report.scenario === 'string' && Boolean(report.scenario.trim());

  const formatToken = (value: unknown): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return value.toLocaleString();
  };

  // 处理保存为图片的功能
  const handleSaveImage = async () => {
    if (!cardRef.current) return;

    try {
      // 截图前隐藏按钮和显示Logo
      const buttonsContainer = cardRef.current.querySelector('.buttons-container') as HTMLElement;
      const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;

      if (buttonsContainer) buttonsContainer.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(cardRef.current, { scale: 1 });

      // 截图后恢复按钮和隐藏Logo
      if (buttonsContainer) buttonsContainer.style.display = 'flex';
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
        // 使用新闻标题并清理特殊字符作为文件名
        const sanitizedTitle = headline.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_') || 'battle_report';
        downloadLink.download = `魔法少女速报_${sanitizedTitle}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error("Image generation failed:", err);
      // 确保在出错时也恢复按钮
      const buttonsContainer = cardRef.current?.querySelector('.buttons-container') as HTMLElement;
      const logoPlaceholder = cardRef.current?.querySelector('.logo-placeholder') as HTMLElement;

      if (buttonsContainer) buttonsContainer.style.display = 'flex';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    }
  };

  // 处理保存为Markdown文件
  const handleSaveMarkdown = () => {
    // 3. [修改] 在Markdown中加入随机判定记录
    const adjudicationMarkdown = report.adjudicationResults && report.adjudicationResults.length > 0
        ? `
---

## 随机判定记录
${report.adjudicationResults.map(res => {
    const prefix = ' '.repeat(res.depth * 2); // 根据深度添加缩进
    return `${prefix}- **事件**: ${res.description}\n${prefix}  - **结果**: ${res.outcome} (${res.details})`;
}).join('\n')}
`
        : '';

    const markdownContent = `
# ${headline}
**来源：${reporterPublication || '—'} | 记者：${reporterName || '—'}**
${mode ? `**模式：${modeDisplay?.text}**\n` : ''}
---

## 新闻正文
${bodyContent}

---

## 记者点评
> ${analysisContent}

---

## 官方通报
- **胜利者**: ${officialWinner || '—'}
- **最终结果**: ${officialConclusion || '—'}
${report.userGuidance ? `
---

## 故事引导
> ${report.userGuidance}` : ''}
${adjudicationMarkdown}
    `.trim();

    // 创建Blob对象并触发下载
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const sanitizedTitle = headline.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_') || 'battle_report';
    link.download = `魔法少女速报_${sanitizedTitle}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const markdownComponents: Components = {
    h1: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,
    h2: ({ children }) => <h4 className="text-base font-semibold mt-4 mb-2">{children}</h4>,
    h3: ({ children }) => <h5 className="text-sm font-semibold mt-3 mb-1 opacity-95">{children}</h5>,
    p: ({ children }) => <p className="text-sm opacity-90 leading-relaxed mb-2 whitespace-pre-wrap">{children}</p>,
    ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-sm opacity-90">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm opacity-90">{children}</ol>,
    li: ({ children }) => <li className="opacity-90">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-white/20 bg-black/15 px-3 py-2 text-sm opacity-90">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-white/15" />,
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-lg bg-black/25 p-3 text-xs leading-relaxed">{children}</pre>
    ),
    code: ({ inline, className, children, node, ...props }: MarkdownCodeProps) => {
      void node;

      const text =
        typeof children === 'string'
          ? children
          : Array.isArray(children)
            ? children.filter((child): child is string => typeof child === 'string').join('')
            : '';

      const looksLikeBlock = Boolean(className && /\blanguage-/.test(className)) || text.includes('\n');
      const isInline = typeof inline === 'boolean' ? inline : !looksLikeBlock;

      return isInline ? (
        <code
          className="font-mono text-xs bg-black/30 px-1 py-0.5 rounded text-pink-200"
          {...props}
        >
          {children}
        </code>
      ) : (
        <code className={['font-mono text-xs', className].filter(Boolean).join(' ')} {...props}>
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-white/15 bg-black/15">
        <table className="min-w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-white/10">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-white/10">{children}</tbody>,
    tr: ({ children }) => <tr className="odd:bg-white/5 hover:bg-white/10 transition-colors">{children}</tr>,
    th: ({ children }) => (
      <th className="px-3 py-2 font-semibold text-gray-100 border-b border-white/10 whitespace-nowrap">{children}</th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 text-gray-100/90 align-top border-b border-white/5 whitespace-pre-wrap break-words">{children}</td>
    ),
  };

  return (
    <div
      ref={cardRef}
      className="result-card"
      style={{ background: 'linear-gradient(135deg, #3040a1 0%, #000000 50%, #8B0000 100%)' }}
    >
      <div className="result-content">
        <img src="/arena-white.svg" style={{ marginTop: '1rem' }} width={320} height={90} alt="魔法少女竞技场" className="feature-title-svg" />

        {showScenarioTitle && <h3 className='ml-2 font-bold text-gray-100'>~ {String(report.scenario)} ~</h3> }
        <h2 className="text-xl font-bold mt-8 mb-2" style={{ marginLeft: '0.5rem' }}>{headline}</h2>
        <div style={{ position: 'relative', marginLeft: '0.5rem', minHeight: '60px' }}>
          <div>
            <p className="text-sm text-gray-300">
              记者 | {reporterName || '—'}
            </p>
            <p className="text-sm text-gray-300">
              来源 | {reporterPublication || '—'}
            </p>
            <GeneratedByUserBadge variant="dark" className="mt-2" />
            {(hasAnyTokenNumber || shouldShowNarrativeReadCount) && (
              <p className="text-xs text-gray-400 mt-1">
                {hasAnyTokenNumber && (
                  <>
                    tokens：输入 {formatToken(aiUsage?.promptTokens)}｜推理 {formatToken(aiUsage?.reasoningTokens)}｜输出{' '}
                    {formatToken(aiUsage?.completionTokens)}
                  </>
                )}
                {hasAnyTokenNumber && shouldShowNarrativeReadCount ? ' · ' : ''}
                {shouldShowNarrativeReadCount && <>叙事历史读取：{report.narrativeHistoryReadCount} 条</>}
              </p>
            )}
          </div>
          {/* 显示战斗模式 */}
          {modeDisplay && (
            <img
              src={modeDisplay.logo}
              alt={modeDisplay.text}
              style={{ 
                position: 'absolute',
                top: '-0.5rem',
                right: '0rem',
                width: '120px', 
                height: '60px' 
              }} 
            />
          )}  
        </div>
        
        <div className="result-item">
          <div className="result-value">
            <ReactMarkdown remarkPlugins={[remarkBattleTable]} components={markdownComponents}>
              {bodyContent}
            </ReactMarkdown>
          </div>
        </div>

        <div className="result-item" style={{ borderLeft: '4px solid #ff6b9d', background: 'rgba(0,0,0,0.2)' }}>
          <div className="result-label">🎤 记者点评</div>
          <div className="result-value">
            <p className="text-sm opacity-90 italic">{analysisContent}</p>
          </div>
        </div>

        <div className="result-item">
          <div className="result-value">
            <h3 className="font-semibold mt-2">胜利者</h3>
            <p className="text-sm opacity-90" style={{ marginBottom: '0.5rem' }}>{officialWinner || '—'}</p>
            <h3 className="font-semibold mt-2">最终结果</h3>
            <p className="text-sm opacity-90" style={{ marginBottom: '0.5rem' }}>{officialConclusion || '—'}</p>
          </div>
        </div>

        {/* 新增：如果用户提供了引导信息，则显示此区域 */}
        {report.userGuidance && (
          <div className="result-item" style={{ borderLeft: '4px solid #a78bfa', background: 'rgba(0,0,0,0.2)' }}>
            <div className="result-label">📖 故事引导</div>
            <div className="result-value">
              <p className="text-sm opacity-90 italic">“{report.userGuidance}”</p>
            </div>
          </div>
        )}

        {/* 4. [新增] 随机判定结果的渲染区域 */}
        {report.adjudicationResults && report.adjudicationResults.length > 0 && (
            <div className="result-item" style={{ borderLeft: '4px solid #4ade80', background: 'rgba(0,0,0,0.2)' }}>
                <div className="result-label">🎲 随机判定记录</div>
                <div className="result-value space-y-2 text-sm">
                    {report.adjudicationResults.map((result, index) => (
                        <div key={index} style={{ marginLeft: `${result.depth * 16}px` }}>
                            <p className="opacity-90">
                                {result.depth > 0 && <span className="text-gray-400">↳ </span>}
                                <span className="font-semibold">{result.description}</span>
                            </p>
                            <p className="text-xs opacity-70">
                                判定结果: <span className={`font-bold ${result.outcome === '成功' ? 'text-green-400' : result.outcome === '失败' ? 'text-red-400' : 'text-blue-400'}`}>{result.outcome}</span> ({result.details})
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* 按钮容器 */}
        <div className="buttons-container flex gap-2 justify-center mt-4" style={{ alignItems: 'stretch' }}>
          {onSaveImage && (
            <button onClick={handleSaveImage} className="save-button" style={{ marginTop: 0, flex: 1 }}>
              📱 保存为图片
            </button>
          )}
          <button onClick={handleSaveMarkdown} className="save-button" style={{ marginTop: 0, flex: 1 }}>
            📄 下载战斗记录
          </button>
        </div>

        {/* Logo占位符，用于截图 */}
        <div className="logo-placeholder" style={{ display: 'none', justifyContent: 'center', marginTop: '1rem' }}>
          <img
            src="/logo-white-qrcode.svg"
            width={280}
            height={280}
            alt="Logo"
            style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
          />
        </div>
      </div>
    </div>
  );
};

export default BattleReportCard;
