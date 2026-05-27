// components/StreamingBattleReportCard.tsx

import React, { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import type { AdjudicationResult } from '@/types/arena';
import remarkBattleTable from '@/lib/markdown/remarkBattleTable';
import { fixNestedListIndentation } from '@/lib/markdown/fix-list-indentation';
import {
    formatMarkdownImage,
    formatMarkdownLink,
    isAllowedExternalMediaUrl,
    isLikelyAudioUrl,
    isLikelyVideoUrl,
    resolveExternalMediaUrl,
} from '@/lib/markdown/externalMedia';
import {
    buildAdjudicationRecordMarkdown,
    hasAdjudicationRecordSection,
    resolveAdjudicationOutcomeTone,
} from '@/lib/adjudicator/presentation';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { extractHeuristicReasoningFromMarkdown } from '@/lib/ai/reasoning-normalizer';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import type { BattleReportIllustrationAsset } from '@/components/BattleReportCard';

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
    /** 本次生成时的逐角色行动/想法引导快照（可选） */
    characterGuidances?: Array<{ characterName: string; guidance: string }> | null;
    /** 本次生成时的随机判定结果 */
    adjudicationResults?: AdjudicationResult[] | null;
    /** AI 生成 token 统计（输入/推理/输出），可选。 */
    aiUsage?: {
        promptTokens?: number | null;
        reasoningTokens?: number | null;
        completionTokens?: number | null;
        totalTokens?: number | null;
        cachedTokens?: number | null;
        [key: string]: unknown;
    } | null;
    /** 本次生成所使用的 AI 模型（用于战报元数据展示，可能为空）。 */
    aiModel?: string | null;
    /** 读取叙事历史条数：仅在开启 readNarrativeHistory 时传入（没开就不显示）。 */
    narrativeHistoryReadCount?: number | null;
    /** AI 思考内容（结构化，优先使用）。 */
    aiReasoning?: AIReasoningEnvelope | null;
    /** 是否正在生成中（可选，用于显示加载光标等） */
    isStreaming?: boolean;
    /** 流式生成中的手动中止回调。 */
    onStopGeneration?: () => void;
    /** 战报插图（可选，支持生成图或用户上传图） */
    illustrationAsset?: BattleReportIllustrationAsset | null;
    /** 手动指定卡片宽度（px）；为空时自动铺满容器。 */
    cardWidthPx?: number | null;
}

const StreamingBattleReportCard: React.FC<StreamingBattleReportCardProps> = ({
    content,
    onSaveImage,
    mode,
    scenarioName,
    reporterInfo = null,
    userGuidance = null,
    characterGuidances = null,
    adjudicationResults = null,
    aiUsage = null,
    aiModel = null,
    narrativeHistoryReadCount = null,
    aiReasoning = null,
    isStreaming = false,
    onStopGeneration,
    illustrationAsset = null,
    cardWidthPx = null
}) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [isSavingImage, setIsSavingImage] = useState(false);
    const headlineMatch = content.match(/^\s*#{1,3}\s*(.*)(?:\r?\n|$)/);
    const headline = headlineMatch ? headlineMatch[1].trim() : '';
    const markdownBody = fixNestedListIndentation(headlineMatch && headline ? content.slice(headlineMatch[0].length).trimStart() : content);
    const illustrationImageUrl = typeof illustrationAsset?.imageUrl === 'string' ? illustrationAsset.imageUrl.trim() : '';
    const uploadedIllustrationNote =
        illustrationAsset?.source === 'uploaded'
            ? (typeof illustrationAsset.note === 'string' && illustrationAsset.note.trim() ? illustrationAsset.note.trim() : '用户自行上传')
            : '';
    const aiReasoningText = typeof aiReasoning?.text === 'string' ? aiReasoning.text.trim() : '';
    const heuristicReasoning = !aiReasoningText ? extractHeuristicReasoningFromMarkdown(markdownBody) : null;
    const reasoningForPanel =
        aiReasoningText || aiReasoning?.status === 'thinking'
            ? aiReasoning
            : (heuristicReasoning ?? aiReasoning);

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
    const hasAnyTokenNumber =
        aiUsage != null &&
        [aiUsage.promptTokens, aiUsage.reasoningTokens, aiUsage.completionTokens].some(
            (value) => typeof value === 'number' && Number.isFinite(value)
        );
    const shouldShowNarrativeReadCount = typeof narrativeHistoryReadCount === 'number';
    const aiModelText = typeof aiModel === 'string' ? aiModel.trim() : '';
    const shouldShowAiModel = Boolean(aiModelText);

    const formatToken = (value: unknown): string => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
        return value.toLocaleString();
    };

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
            const match = raw.match(/^\s*#{1,3}\s*.*(?:\r?\n|$)/);
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

        const normalizedCharacterGuidances =
            Array.isArray(characterGuidances)
                ? characterGuidances
                    .map((item) => {
                        const characterName = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
                        const guidance = typeof item?.guidance === 'string' ? item.guidance.trim() : '';
                        if (!characterName || !guidance) return null;
                        return { characterName, guidance };
                    })
                    .filter(Boolean) as Array<{ characterName: string; guidance: string }>
                : [];
        const hasCharacterGuidanceSection = /(^|\n)##\s*角色行动引导\s*(\n|$)/.test(result);
        if (!hasCharacterGuidanceSection && normalizedCharacterGuidances.length > 0) {
            const lines = normalizedCharacterGuidances.map((item) => `- ${item.characterName}：${item.guidance}`).join('\n');
            result = `${result.trim()}\n\n---\n\n## 角色行动引导\n${lines}\n`;
        }

        const adjudicationSection = buildAdjudicationRecordMarkdown(adjudicationResults);
        if (!hasAdjudicationRecordSection(result) && adjudicationSection) {
            result = `${result.trim()}\n\n---\n\n${adjudicationSection}\n`;
        }

        return result.trim();
    };

    // --- 截图功能逻辑 (与原组件保持一致) ---
    const handleSaveImage = async () => {
        if (!cardRef.current) return;
        if (isSavingImage) return;

        const buttonsContainer = cardRef.current.querySelector('.buttons-container') as HTMLElement | null;
        const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement | null;
        const reasoningPanels = Array.from(cardRef.current.querySelectorAll('.ai-reasoning-panel')) as HTMLElement[];

        try {
            setIsSavingImage(true);

            if (buttonsContainer) buttonsContainer.style.display = 'none';
            if (logoPlaceholder) logoPlaceholder.style.display = 'flex';
            reasoningPanels.forEach((panel) => {
                panel.style.display = 'none';
            });

            const titleMatch = content.match(/^#{1,3}\s*(.+)$/m);
            const title = titleMatch ? titleMatch[1] : '战斗战报';
            const sanitizedTitle = title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
            const filename = `魔法少女速报_${sanitizedTitle}.png`;

            const blob = await capturePngBlob(cardRef.current, {
                scale: 1,
                dprMax: 2,
                fast: false,
                exclude: ['audio', 'video'],
                excludeMode: 'remove',
            });

            const isMobileDevice = /Mobi/i.test(window.navigator.userAgent);

            if (isMobileDevice) {
                const canShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator;
                if (canShare && typeof File !== 'undefined') {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        const shareData: ShareData = { files: [file], title };
                        if (navigator.canShare(shareData)) {
                            await navigator.share({ files: [file], title });
                            return;
                        }
                    } catch (shareError) {
                        console.warn('图片分享失败，将回退到长按保存弹窗', shareError);
                    }
                }

                if (onSaveImage) {
                    onSaveImage(createBlobUrl(blob));
                }
            } else {
                downloadBlob(blob, filename);
            }
        } catch (err) {
            alert('生成图片失败，请重试');
            console.error('Image generation failed:', err);
        } finally {
            if (buttonsContainer) buttonsContainer.style.display = 'flex';
            if (logoPlaceholder) logoPlaceholder.style.display = 'none';
            reasoningPanels.forEach((panel) => {
                panel.style.display = '';
            });
            setIsSavingImage(false);
        }
    };

    // --- 下载 Markdown 逻辑 ---
    const handleSaveMarkdown = () => {
        const exportMarkdown = buildExportMarkdown();
        const blob = new Blob([exportMarkdown], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        const titleMatch = exportMarkdown.match(/^#{1,3}\s*(.+)$/m);
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
        a: ({ href, title, children, ...props }) => {
            const rawHref = typeof href === 'string' ? href : '';
            const isExternal = /^https?:\/\//i.test(rawHref);
            const isAudioLink = Boolean(rawHref && isLikelyAudioUrl(rawHref));
            const isVideoLink = Boolean(rawHref && isLikelyVideoUrl(rawHref));
            const normalizedHref = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
            const isAudioAllowed = isAudioLink && isAllowedExternalMediaUrl(rawHref, 'audio');
            const isVideoAllowed = isVideoLink && isAllowedExternalMediaUrl(rawHref, 'video');
            const resolvedAudioHref = isAudioLink ? resolveExternalMediaUrl(rawHref, 'audio') : normalizedHref;
            const resolvedVideoHref = isVideoLink ? resolveExternalMediaUrl(rawHref, 'video') : normalizedHref;
            const linkText =
                typeof children === 'string'
                    ? children
                    : Array.isArray(children)
                        ? children.filter((child): child is string => typeof child === 'string').join('')
                        : '';

            if (isAudioLink) {
                if (!isAudioAllowed) {
                    return (
                        <code className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded text-pink-200 break-all">
                            {formatMarkdownLink(linkText || '播放音频', rawHref, title)}
                        </code>
                    );
                }

                return (
                    <span className="inline-flex max-w-full flex-col gap-1 align-middle">
                        <audio controls preload="none" src={resolvedAudioHref} className="h-8 max-w-full" />
                        <a
                            href={resolvedAudioHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] underline underline-offset-2 text-blue-200"
                            {...props}
                        >
                            {linkText || '打开音频链接'}
                        </a>
                    </span>
                );
            }

            if (isVideoLink) {
                const videoLabel = linkText || '播放视频';
                if (!isVideoAllowed) {
                    return (
                        <code className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded text-pink-200 break-all">
                            {formatMarkdownLink(videoLabel, rawHref, title)}
                        </code>
                    );
                }

                return (
                    <span className="inline-flex max-w-full flex-col gap-1 align-middle">
                        <video controls preload="metadata" playsInline src={resolvedVideoHref} className="my-2 max-w-full rounded-md border border-white/15" />
                        <a
                            href={resolvedVideoHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] underline underline-offset-2 text-blue-200"
                            {...props}
                        >
                            {videoLabel}
                        </a>
                    </span>
                );
            }

            return (
                <a
                    href={href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer' : undefined}
                    className="underline underline-offset-2 text-blue-200 opacity-90 hover:opacity-100"
                    {...props}
                >
                    {children}
                </a>
            );
        },
        // ul -> 列表 (用于随机判定记录等)
        ul: ({ children, ...props }) => (
            <ul className="list-none space-y-2 my-2 text-sm bg-black/20 p-3 rounded border-l-4 border-green-400" {...props}>
                {children}
            </ul>
        ),
        // ol -> 有序列表
        ol: ({ children, ...props }) => (
            <ol className="list-decimal pl-5 my-2 space-y-1 text-sm opacity-90" {...props}>
                {children}
            </ol>
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
        img: ({ src, alt, title, ...props }) => {
            const rawSrc = typeof src === 'string' ? src : '';
            const isAudioLink = Boolean(rawSrc && isLikelyAudioUrl(rawSrc));
            const isVideoLink = Boolean(rawSrc && isLikelyVideoUrl(rawSrc));
            if (isAudioLink) {
                const isAudioAllowed = isAllowedExternalMediaUrl(rawSrc, 'audio');
                const normalizedSrc = resolveExternalMediaUrl(rawSrc, 'audio');
                const audioLabel = typeof alt === 'string' && alt.trim() ? alt.trim() : '播放音频';

                if (!isAudioAllowed) {
                    return (
                        <code className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded text-pink-200 break-all">
                            {formatMarkdownImage(alt, rawSrc, title)}
                        </code>
                    );
                }

                return (
                    <span className="inline-flex max-w-full flex-col gap-1 align-middle">
                        <audio controls preload="none" src={normalizedSrc} className="h-8 max-w-full" />
                        <a
                            href={normalizedSrc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] underline underline-offset-2 text-blue-200"
                        >
                            {audioLabel}
                        </a>
                    </span>
                );
            }

            if (isVideoLink) {
                const isVideoAllowed = isAllowedExternalMediaUrl(rawSrc, 'video');
                const normalizedSrc = resolveExternalMediaUrl(rawSrc, 'video');
                const videoLabel = typeof alt === 'string' && alt.trim() ? alt.trim() : '播放视频';

                if (!isVideoAllowed) {
                    return (
                        <code className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded text-pink-200 break-all">
                            {formatMarkdownImage(alt, rawSrc, title)}
                        </code>
                    );
                }

                return (
                    <span className="inline-flex max-w-full flex-col gap-1 align-middle">
                        <video controls preload="metadata" playsInline src={normalizedSrc} className="my-2 max-w-full rounded-md border border-white/15" />
                        <a
                            href={normalizedSrc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] underline underline-offset-2 text-blue-200"
                        >
                            {videoLabel}
                        </a>
                    </span>
                );
            }

            const isAllowed = isAllowedExternalMediaUrl(rawSrc, 'image');
            const normalizedSrc = resolveExternalMediaUrl(rawSrc, 'image');
            if (!isAllowed) {
                return (
                    <code className="font-mono text-xs bg-gray-800 px-1 py-0.5 rounded text-pink-200 break-all">
                        {formatMarkdownImage(alt, rawSrc, title)}
                    </code>
                );
            }

            return (
                <img
                    src={normalizedSrc}
                    alt={typeof alt === 'string' ? alt : ''}
                    title={typeof title === 'string' ? title : undefined}
                    className="my-2 max-w-full rounded-md border border-white/15"
                    loading="lazy"
                    {...props}
                />
            );
        },
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
                width: '100%',
                maxWidth: cardWidthPx ? `${cardWidthPx}px` : '100%',
                marginLeft: 'auto',
                marginRight: 'auto',
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

                {(reporterInfo?.name && reporterInfo?.publication) || shouldShowAiModel || hasAnyTokenNumber || shouldShowNarrativeReadCount ? (
                    <div className="px-1 mb-4 text-sm text-gray-300">
                        {reporterInfo?.name && reporterInfo?.publication && (
                            <>
                                <p>记者 | {reporterInfo.name}</p>
                                <p>来源 | {reporterInfo.publication}</p>
                            </>
                        )}
                        {(shouldShowAiModel || hasAnyTokenNumber || shouldShowNarrativeReadCount) && (
                            <p className="text-xs text-gray-400 mt-1">
                                {shouldShowAiModel && <>模型：{aiModelText}</>}
                                {shouldShowAiModel && (hasAnyTokenNumber || shouldShowNarrativeReadCount) ? ' · ' : ''}
                                {hasAnyTokenNumber && (
                                    <>
                                        tokens：输入 {formatToken(aiUsage?.promptTokens)}｜推理 {formatToken(aiUsage?.reasoningTokens)}｜输出{' '}
                                        {formatToken(aiUsage?.completionTokens)}
                                    </>
                                )}
                                {hasAnyTokenNumber && shouldShowNarrativeReadCount ? ' · ' : ''}
                                {shouldShowNarrativeReadCount && <>叙事历史读取：{narrativeHistoryReadCount} 条</>}
                            </p>
                        )}
                    </div>
                ) : null}

                {reasoningForPanel && (
                    <AiReasoningPanel
                        reasoning={reasoningForPanel}
                        status={reasoningForPanel.status}
                        compact
                        defaultExpanded={false}
                    />
                )}

                {illustrationImageUrl && (
                    <div className="mt-4 border-l-4 border-pink-300 bg-black/20 p-3 rounded">
                        <div className="text-sm font-semibold mb-2">🎨 战报插图</div>
                        <img
                            src={illustrationImageUrl}
                            alt={`${headline || '战报'} 插图`}
                            className="w-full max-h-[560px] object-contain rounded-lg border border-white/15 bg-black/15"
                            loading="eager"
                            decoding="async"
                        />
                        {uploadedIllustrationNote && (
                            <p className="mt-2 text-[11px] text-gray-300 text-right">
                                注：{uploadedIllustrationNote}
                            </p>
                        )}
                    </div>
                )}

                {/* Markdown 内容渲染区域 */}
                <div className="min-h-[200px]">
                    <ReactMarkdown
                        remarkPlugins={[remarkBattleTable, [remarkMath, { singleDollarTextMath: true }]]}
                        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
                        components={markdownComponents}
                    >
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

                {Array.isArray(characterGuidances) && characterGuidances.length > 0 && (
                    <div className="mt-4 border-l-4 border-indigo-300 bg-black/20 p-3 rounded">
                        <div className="text-sm font-semibold mb-2">🎭 角色行动引导</div>
                        <div className="space-y-2 text-sm">
                            {characterGuidances
                                .map((item, index) => {
                                    const characterName = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
                                    const guidance = typeof item?.guidance === 'string' ? item.guidance.trim() : '';
                                    if (!characterName || !guidance) return null;
                                    return (
                                        <div key={`${characterName}-${index}`} className="opacity-90">
                                            <span className="font-semibold">{characterName}</span>
                                            <span className="opacity-80">：{guidance}</span>
                                        </div>
                                    );
                                })
                                .filter(Boolean)}
                        </div>
                    </div>
                )}

                {adjudicationResults && adjudicationResults.length > 0 && (
                    <div className="mt-4 border-l-4 border-green-400 bg-black/20 p-3 rounded">
                        <div className="text-sm font-semibold mb-2">🎲 随机判定记录</div>
                        <div className="space-y-2 text-sm">
                            {adjudicationResults.map((result, index) => {
                                const outcomeTone = resolveAdjudicationOutcomeTone(result.outcome);
                                return (
                                    <div key={index} style={{ marginLeft: `${result.depth * 16}px` }}>
                                        <p className="opacity-90">
                                            {result.depth > 0 && <span className="text-gray-400">↳ </span>}
                                            <span className="font-semibold">{result.description}</span>
                                        </p>
                                        <p className="text-xs opacity-70">
                                            判定结果:{' '}
                                            <span
                                                className={`font-bold ${
                                                    outcomeTone === 'success'
                                                        ? 'text-green-300'
                                                        : outcomeTone === 'failure'
                                                            ? 'text-red-300'
                                                            : 'text-blue-300'
                                                }`}
                                            >
                                                {result.outcome}
                                            </span>{' '}
                                            ({result.details})
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 底部按钮 */}
                <div className="buttons-container flex gap-2 justify-center mt-6 pt-4 border-t border-gray-700" style={{ alignItems: 'stretch' }}>
                    {onSaveImage && (
                        <button
                            onClick={isStreaming && onStopGeneration ? onStopGeneration : handleSaveImage}
                            disabled={isSavingImage}
                            className="save-button flex-1 bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isStreaming && onStopGeneration ? '⏹ 停止生成' : isSavingImage ? '生成中...' : '📱 保存为图片'}
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
                <div
                    className="logo-placeholder"
                    style={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}
                >
                    <img
                        src="/logo-white-qrcode.svg"
                        width={280}
                        height={280}
                        alt="Logo"
                        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                    />
                    <GeneratedByUserBadge variant="dark" className="mt-3" />
                </div>
            </div>
        </div>
    );
};

export default StreamingBattleReportCard;
