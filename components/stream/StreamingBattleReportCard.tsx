// components/StreamingBattleReportCard.tsx

import React, { useRef } from 'react';
import { snapdom } from '@zumer/snapdom';
import ReactMarkdown from 'react-markdown';
import { Components } from 'react-markdown';
import type { AdjudicationResult } from '@/types/arena';
import remarkBattleTable from '@/lib/markdown/remarkBattleTable';

interface StreamingBattleReportCardProps {
    /** 流式输入的 Markdown 文本内容 */
    content: string;
    onSaveImage?: (imageUrl: string) => void;
    mode?: 'classic' | 'kizuna' | 'daily' | 'scenario';
    /** 情景模式下的场景名称 */
    scenarioName?: string;
    /** 记者与来源信息（用于补齐与非流式一致的展示） */
    reporterInfo?: { name: string; publication: string } | null;
    /** 本次生成时的故事引导快照 */
    userGuidance?: string | null;
    /** 本次生成时的随机判定结果 */
    adjudicationResults?: AdjudicationResult[] | null;
    /** 是否正在生成中（可选，用于显示加载光标等） */
    isStreaming?: boolean;
}

const StreamingBattleReportCard: React.FC<StreamingBattleReportCardProps> = ({
    content,
    onSaveImage,
    mode,
    scenarioName,
    reporterInfo = null,
    userGuidance = null,
    adjudicationResults = null,
    isStreaming = false
}) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const headlineMatch = content.match(/^\s*#\s*(.*)(?:\r?\n|$)/);
    const headline = headlineMatch ? headlineMatch[1].trim() : '';
    const markdownBody = headlineMatch && headline ? content.slice(headlineMatch[0].length).trimStart() : content;

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

    const buildExportMarkdown = (): string => {
        const metaLines: string[] = [];
        if (reporterInfo?.name && reporterInfo?.publication) {
            metaLines.push(`**来源：${reporterInfo.publication} | 记者：${reporterInfo.name}**`);
        }
        if (modeDisplay?.text) {
            metaLines.push(`**模式：${modeDisplay.text}**`);
        }

        const metaBlock = metaLines.length > 0 ? `${metaLines.join('\n')}\n` : '';

        const insertMetaAfterTitle = (raw: string): string => {
            if (!metaBlock) return raw;
            const match = raw.match(/^\s*#\s*.*(?:\r?\n|$)/);
            if (!match) {
                return `# 战斗战报\n${metaBlock}\n${raw}`.trim();
            }
            const head = match[0];
            const rest = raw.slice(head.length);
            return `${head}${metaBlock}\n${rest}`.trim();
        };

        let result = insertMetaAfterTitle(content);

        const hasGuidanceSection = /(^|\n)##\s*故事引导\s*(\n|$)/.test(result);
        if (!hasGuidanceSection && userGuidance?.trim()) {
            result = `${result.trim()}\n\n---\n\n## 故事引导\n> ${userGuidance.trim()}\n`;
        }

        const hasAdjudicationSection = /(^|\n)##\s*随机判定记录\s*(\n|$)/.test(result);
        if (!hasAdjudicationSection && adjudicationResults && adjudicationResults.length > 0) {
            const adjudicationMarkdown = adjudicationResults
                .map((res) => {
                    const prefix = ' '.repeat(res.depth * 2);
                    return `${prefix}- **事件**: ${res.description}\n${prefix}  - **结果**: ${res.outcome} (${res.details})`;
                })
                .join('\n');

            result = `${result.trim()}\n\n---\n\n## 随机判定记录\n${adjudicationMarkdown}\n`;
        }

        return result.trim();
    };

    // --- 截图功能逻辑 (与原组件保持一致) ---
    const handleSaveImage = async () => {
        if (!cardRef.current) return;

        try {
            const buttonsContainer = cardRef.current.querySelector('.buttons-container') as HTMLElement;
            const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement;

            if (buttonsContainer) buttonsContainer.style.display = 'none';
            if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

            const result = await snapdom(cardRef.current, { scale: 2 }); // 稍微调高scale以获得清晰文字

            if (buttonsContainer) buttonsContainer.style.display = 'flex';
            if (logoPlaceholder) logoPlaceholder.style.display = 'none';

            const imgElement = await result.toPng();
            const imageUrl = imgElement.src;
            const isMobileDevice = /Mobi/i.test(window.navigator.userAgent);

            if (isMobileDevice) {
                if (onSaveImage) onSaveImage(imageUrl);
            } else {
                const downloadLink = document.createElement('a');
                downloadLink.href = imageUrl;
                // 尝试从 content 中提取第一行作为文件名
                const titleMatch = content.match(/^#\s*(.+)$/m);
                const title = titleMatch ? titleMatch[1] : '战斗战报';
                const sanitizedTitle = title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
                downloadLink.download = `魔法少女速报_${sanitizedTitle}.png`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            }
        } catch (err) {
            alert('生成图片失败，请重试');
            console.error("Image generation failed:", err);
            const buttonsContainer = cardRef.current?.querySelector('.buttons-container') as HTMLElement;
            if (buttonsContainer) buttonsContainer.style.display = 'flex';
        }
    };

    // --- 下载 Markdown 逻辑 ---
    const handleSaveMarkdown = () => {
        const exportMarkdown = buildExportMarkdown();
        const blob = new Blob([exportMarkdown], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        const titleMatch = exportMarkdown.match(/^#\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1] : '战斗战报';
        const sanitizedTitle = title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');

        link.download = `魔法少女速报_${sanitizedTitle}.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // --- 自定义 Markdown 渲染组件 ---
    const markdownComponents: Components = {
        // # Headline -> 主标题
        h1: ({ children, ...props }) => (
            <h2 className="text-xl font-bold mb-4 mt-2 px-1" {...props}>
                {children}
            </h2>
        ),
        // ## Title -> 板块分割标题
        h2: ({ children, ...props }) => (
            <div className="mt-6 mb-2 pb-1 px-1 border-b border-gray-600/50" {...props}>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    {children}
                </h3>
            </div>
        ),
        // ### Subtitle -> 内部小标题 (如: 胜利者, 判定结果)
        h3: ({ children, ...props }) => (
            <h4 className="font-semibold mt-3 mb-1 px-1 text-base text-gray-200" {...props}>
                {children}
            </h4>
        ),
        // > Blockquote -> 引用块 (用于点评、引导、特殊说明)
        // 根据内容的一致性，我们可以通过简单的正则判断给引用块不同的边框颜色
        blockquote: ({ children }) => (
            // 这里只是为了演示，实际应用可能需要更复杂的逻辑，或者统一使用默认样式
            // 默认使用粉色 (记者点评样式)
            <div className="result-item my-3" style={{ background: 'rgba(131, 131, 131, 0.2)', padding: '0.5rem 1rem' }} >
                <div className="text-sm opacity-90">
                    {children}
                </div>
            </div>
        ),
        // p -> 正文文本
        p: ({ children, ...props }) => (
            // <p className="text-sm px-1 opacity-90 leading-relaxed mb-2 whitespace-pre-wrap rounded" style={{ background: 'rgba(84, 84, 84, 0.5)', padding: '1rem 1rem' }} {...props}>
            <p className="text-sm px-1 opacity-90 leading-relaxed mb-2 whitespace-pre-wrap rounded" {...props}>
                {children}
            </p>
        ),
        // ul -> 列表 (用于随机判定记录等)
        ul: ({ children, ...props }) => (
            <ul className="list-none space-y-2 my-2 text-sm bg-black/20 p-3 rounded border-l-4 border-green-400" {...props}>
                {children}
            </ul>
        ),
        li: ({ children, ...props }) => (
            <li className="opacity-90 pl-2 border-l border-gray-700/50" {...props}>
                {children}
            </li>
        ),
        // code -> 行内代码或代码块 (可选：做成一种特殊的强调样式)
        code: ({ children, ...props }) => (
            <span className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded text-pink-200" {...props}>
                {children}
            </span>
        ),
        table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-white/15 bg-black/15">
                <table className="min-w-full border-collapse text-left text-sm">
                    {children}
                </table>
            </div>
        ),
        thead: ({ children }) => (
            <thead className="bg-white/10">
                {children}
            </thead>
        ),
        tbody: ({ children }) => (
            <tbody className="divide-y divide-white/10">
                {children}
            </tbody>
        ),
        tr: ({ children }) => (
            <tr className="odd:bg-white/5 hover:bg-white/10 transition-colors">
                {children}
            </tr>
        ),
        th: ({ children }) => (
            <th className="px-3 py-2 font-semibold text-gray-100 border-b border-white/10 whitespace-nowrap">
                {children}
            </th>
        ),
        td: ({ children }) => (
            <td className="px-3 py-2 text-gray-100/90 align-top border-b border-white/5 whitespace-pre-wrap break-words">
                {children}
            </td>
        ),
    };

    return (
        <div
            ref={cardRef}
            className="result-card relative"
            style={{
                background: 'linear-gradient(135deg, #434343 0%, #000000 100%)',
                color: 'white',
                padding: '1.5rem',
                borderRadius: '1rem',
                maxWidth: '100%',
                overflow: 'hidden'
            }}
        >
            <div className="result-content">
                {/* 顶部 Logo */}
                <img
                    src="/arena-white.svg"
                    style={{ marginBottom: '0rem', marginTop: '0.5rem' }}
                    width={280}
                    height={90}
                    alt="魔法少女竞技场"
                />

                {/* 模式 Logo (绝对定位) */}
                <div style={{ position: 'relative', width: '100%' }}>
                    {modeDisplay && (
                        <img
                            src={modeDisplay.logo}
                            alt={modeDisplay.text}
                            style={{
                                position: 'absolute',
                                top: '-7.1rem', // 调整位置以适应流式布局的顶部
                                right: '-1rem',
                                width: '120px',
                                height: '60px',
                                opacity: 0.8
                            }}
                        />
                    )}
                </div>
                { scenarioName && <h3 className='ml-2 mb-4 font-bold text-gray-100'>~ {scenarioName.replace(".json", "")} ~</h3> }

                {headline && <h2 className="text-xl font-bold mb-2 mt-2 px-1">{headline}</h2>}

                {reporterInfo?.name && reporterInfo?.publication && (
                    <div className="px-1 mb-4 text-sm text-gray-300">
                        <p>记者 | {reporterInfo.name}</p>
                        <p>来源 | {reporterInfo.publication}</p>
                    </div>
                )}

                {/* Markdown 内容渲染区域 */}
                <div className="min-h-[200px]">
                    <ReactMarkdown remarkPlugins={[remarkBattleTable]} components={markdownComponents}>
                        {markdownBody}
                    </ReactMarkdown>
                    {/* 闪烁光标，模拟打字效果 */}
                    {isStreaming && (
                        <span className="inline-block w-2 h-4 bg-pink-500 animate-pulse align-middle ml-1"></span>
                    )}
                </div>

                {userGuidance?.trim() && (
                    <div className="mt-6 border-l-4 border-purple-400 bg-black/20 p-3 rounded">
                        <div className="text-sm font-semibold mb-1">📖 故事引导</div>
                        <p className="text-sm opacity-90 italic">“{userGuidance.trim()}”</p>
                    </div>
                )}

                {adjudicationResults && adjudicationResults.length > 0 && (
                    <div className="mt-4 border-l-4 border-green-400 bg-black/20 p-3 rounded">
                        <div className="text-sm font-semibold mb-2">🎲 随机判定记录</div>
                        <div className="space-y-2 text-sm">
                            {adjudicationResults.map((result, index) => (
                                <div key={index} style={{ marginLeft: `${result.depth * 16}px` }}>
                                    <p className="opacity-90">
                                        {result.depth > 0 && <span className="text-gray-400">↳ </span>}
                                        <span className="font-semibold">{result.description}</span>
                                    </p>
                                    <p className="text-xs opacity-70">
                                        判定结果:{' '}
                                        <span
                                            className={`font-bold ${
                                                result.outcome === '成功' || result.outcome === '大成功'
                                                    ? 'text-green-300'
                                                    : result.outcome === '失败' || result.outcome === '大失败'
                                                        ? 'text-red-300'
                                                        : 'text-blue-300'
                                            }`}
                                        >
                                            {result.outcome}
                                        </span>{' '}
                                        ({result.details})
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 底部按钮 */}
                <div className="buttons-container flex gap-2 justify-center mt-6 pt-4 border-t border-gray-700" style={{ alignItems: 'stretch' }}>
                    {onSaveImage && (
                        <button
                            onClick={handleSaveImage}
                            className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all"
                        >
                            📱 保存为图片
                        </button>
                    )}
                    <button
                        onClick={handleSaveMarkdown}
                        className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all"
                    >
                        📄 下载记录
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

export default StreamingBattleReportCard;
