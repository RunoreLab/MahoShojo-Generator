// pages/arrested.tsx

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { loadArrestedBackup, clearArrestedBackup, type ArrestedBackupPackage, type ArrestedBackupItem } from '@/lib/arrested-backup';

export default function ArrestedPage() {
    const router = useRouter();
    const [inspectorId, setInspectorId] = useState('');
    const [caseNumber, setCaseNumber] = useState('');
    const [magicalTimestamp, setMagicalTimestamp] = useState('');
    const [reason, setReason] = useState('使用危险符文'); // 默认理由

    // 存储从JSON加载的新闻列表
    const [newsTickerItems, setNewsTickerItems] = useState<string[]>([]);
    // 当前显示的新闻条目的索引
    const [currentNewsIndex, setCurrentNewsIndex] = useState(0);
    const [backupData, setBackupData] = useState<ArrestedBackupPackage | null>(null);
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [previewItemId, setPreviewItemId] = useState<string | null>(null);

    useEffect(() => {
        // 从 URL query 获取理由
        if (router.isReady && router.query.reason) {
            setReason(router.query.reason as string);
        }

        // 生成巡查使编号
        const generateInspectorId = () => {
            const random = Math.random();
            if (random < 0.4) return '21032'; // 40% 概率为玛格丽特
            if (random < 0.6) return '41076'; // 20% 概率为翠雀 (0.4 + 0.2)
            if (random < 0.7) return '41055'; // 10% 概率为樱 (0.6 + 0.1)
            // 剩下的 30% 概率生成随机5位数
            return Math.floor(10000 + Math.random() * 39999).toString();
        };

        // 随机生成一个案件编号
        const generateCaseNumber = () => {
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const randomLetter = letters[Math.floor(Math.random() * letters.length)];
            const randomNumber = Math.floor(100000 + Math.random() * 900000);
            return `MG-${randomLetter}${randomNumber}`;
        };
        
        // 生成一个日期 (SRS 5.2.4)
        const generateMagicalTimestamp = () => {
            const date = new Date();
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const day = date.getDate();
            return `女王历 ${year} 年 ${month} 月 ${day} 日`;
        };

        setInspectorId(generateInspectorId());
        setCaseNumber(generateCaseNumber());
        setMagicalTimestamp(generateMagicalTimestamp());
    }, [router.isReady, router.query.reason]);

    // --- 获取新闻数据并设置随机初始索引 ---
    useEffect(() => {
        fetch('/arrested_news.json')
            .then(res => res.json())
            .then(data => {
                if (data.news && data.news.length > 0) {
                    setNewsTickerItems(data.news);
                    // 从一个随机索引开始播放，增加趣味性
                    setCurrentNewsIndex(Math.floor(Math.random() * data.news.length));
                }
            })
            .catch(err => console.error("Failed to load arrested news:", err));
    }, []); // 空依赖数组确保此 effect 仅在组件挂载时运行一次

    // --- 设置定时器以循环播放新闻 ---
    useEffect(() => {
        // 仅当新闻列表加载完毕后才启动定时器
        if (newsTickerItems.length === 0) return;

        // 设置一个定时器，每5秒切换到下一条新闻
        const intervalId = setInterval(() => {
            setCurrentNewsIndex(prevIndex => (prevIndex + 1) % newsTickerItems.length);
        }, 5000); // 5000毫秒 = 5秒

        // 组件卸载时清除定时器，防止内存泄漏
        return () => clearInterval(intervalId);
    }, [newsTickerItems]); // 当新闻列表变化时，重新设置定时器

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const stored = loadArrestedBackup();
        if (stored && stored.triggerSource === 'output' && stored.items.length > 0) {
            setBackupData(stored);
            const initialSelection = stored.items.reduce<Record<string, boolean>>((acc, item) => {
                acc[item.id] = true;
                return acc;
            }, {});
            setSelectedItems(initialSelection);
        }
    }, []);

    const shouldShowBackupSection = Boolean(backupData && backupData.triggerSource === 'output' && backupData.items.length > 0);
    const selectedCount = shouldShowBackupSection && backupData
        ? backupData.items.filter(item => selectedItems[item.id]).length
        : 0;
    const hasSelectedItems = selectedCount > 0;

    const formatSize = (size: number): string => {
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    };

    const formatBackupTime = (iso?: string): string => {
        if (!iso) return '未知时间';
        const parsed = new Date(iso);
        if (Number.isNaN(parsed.getTime())) return iso;
        return parsed.toLocaleString('zh-CN', { hour12: false });
    };

    const describeOrigin = (origin?: string): string => {
        switch (origin) {
            case 'battle':
                return '战报故事生成';
            case 'battle-stream':
                return '战报流式生成';
            case 'details':
                return '角色问卷生成';
            default:
                return '生成器';
        }
    };

    const downloadItem = (item: ArrestedBackupItem) => {
        if (typeof window === 'undefined') return;
        const blob = new Blob([item.content], { type: item.mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleDownloadSelected = () => {
        if (!backupData || !hasSelectedItems) return;
        backupData.items.forEach(item => {
            if (selectedItems[item.id]) {
                downloadItem(item);
            }
        });
    };

    const toggleSelection = (itemId: string) => {
        setSelectedItems(prev => ({
            ...prev,
            [itemId]: !prev[itemId],
        }));
    };

    const handlePreviewToggle = (itemId: string) => {
        setPreviewItemId(prev => (prev === itemId ? null : itemId));
    };

    const handleClearBackup = () => {
        clearArrestedBackup();
        setBackupData(null);
        setSelectedItems({});
        setPreviewItemId(null);
    };

    return (
        <>
            <Head>
                <title>调查院正在出动 - 魔法国度调查院</title>
                <meta name="description" content="魔法国度调查院逮捕令" />
                <link rel="icon" href="/favicon.svg" />
            </Head>

            <div className="min-h-screen bg-gradient-to-br from-purple-900 via-violet-800 to-indigo-900 text-white font-sans relative overflow-hidden">
                {/* Magical background patterns */}
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-10 left-10 text-6xl animate-pulse">🌸</div>
                    <div className="absolute top-20 right-20 text-4xl animate-bounce">🌿</div>
                    <div className="absolute top-1/3 left-1/4 text-5xl animate-pulse">🌺</div>
                    <div className="absolute top-2/3 right-1/3 text-3xl animate-bounce">🍃</div>
                    <div className="absolute bottom-20 left-20 text-4xl animate-pulse">🌹</div>
                    <div className="absolute bottom-10 right-10 text-5xl animate-bounce">🌷</div>
                    <div className="absolute top-1/2 left-10 text-3xl animate-pulse">🌻</div>
                    <div className="absolute top-1/4 right-1/4 text-4xl animate-bounce">🌼</div>
                </div>

                {/* Floating magical particles */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute animate-float w-2 h-2 bg-purple-300 rounded-full opacity-60" style={{ top: '20%', left: '15%', animationDelay: '0s' }}></div>
                    <div className="absolute animate-float w-1 h-1 bg-violet-300 rounded-full opacity-70" style={{ top: '40%', left: '80%', animationDelay: '1s' }}></div>
                    <div className="absolute animate-float w-3 h-3 bg-pink-300 rounded-full opacity-50" style={{ top: '60%', left: '25%', animationDelay: '2s' }}></div>
                    <div className="absolute animate-float w-1 h-1 bg-purple-200 rounded-full opacity-80" style={{ top: '80%', left: '70%', animationDelay: '3s' }}></div>
                </div>

                {/* Main magical content */}
                <div className="container mx-auto px-4 py-8 relative z-10" style={{ marginTop: '5rem' }}>
                    {/* Enchanted warning banner */}
                    <div className="text-center text-purple-100" style={{ marginBottom: '0.5rem' }}>您的结果是</div>
                    <div className="bg-gradient-to-r from-pink-600 via-purple-600 to-violet-600 border-2 border-pink-400 rounded-lg p-6 mb-8 text-center shadow-2xl relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-10 animate-pulse"></div>
                        <div className="relative z-10">
                            <div className="text-4xl font-semibold text-purple-100" style={{ padding: '2rem' }}>
                                批 准 逮 捕
                            </div>
                        </div>
                    </div>
                    <div className="text-center text-sm text-purple-200 mb-8">
                        <div>别慌：多数情况下是敏感词误伤或输出命中高风险片段。</div>
                        <div className="mt-2 flex flex-wrap justify-center gap-4">
                            <Link href="/encyclopedia/sensitive-words" className="text-pink-200 hover:underline">敏感词与逮捕（含恢复）</Link>
                            <Link href="/encyclopedia/shield-words" className="text-pink-200 hover:underline">屏蔽词（和谐替换）</Link>
                        </div>
                    </div>

                    {/* Mystical arrest warrant */}
                    <div className="bg-gradient-to-b from-purple-900 to-violet-900 border-2 border-pink-500 rounded-lg p-8 mb-8 shadow-2xl relative">
                        {/* SVG background pattern */}
                        <div
                            className="absolute inset-0 rounded-lg opacity-20 bg-no-repeat bg-center bg-contain"
                            style={{
                                backgroundImage: 'url(/arrest-frame.svg)',
                                backgroundSize: 'contain',
                                backgroundPosition: 'center',
                            }}
                        ></div>
                        <div className="absolute top-4 right-4 text-2xl animate-spin">🌟</div>
                        <div className="absolute bottom-4 left-4 text-2xl animate-bounce">🌟</div>

                        <div className="text-center mb-8 px-4 py-8">
                            <div className="mb-6 text-2xl font-serif text-pink-300">
                                魔法国度调查院
                            </div>
                            <div className="text-sm text-purple-200 mb-8 tracking-widest">
                                M A G I C A L &nbsp; K I N G D O M &nbsp; B U R E A U &nbsp; O F &nbsp; I N V E S T I G A T I O N
                            </div>
                            
                            <div className="text-left text-purple-200 text-sm mx-auto max-w-sm space-y-3 mb-10">
                                <p><strong>案件编号：</strong> {caseNumber}</p>
                                <p><strong>签发时间：</strong> {magicalTimestamp}</p>
                                <p><strong>事由：</strong> {reason}</p>
                                <p><strong>巡查使 花牌认证编号：</strong> {inspectorId}</p>
                            </div>

                            <div className="text-lg md:text-xl text-purple-200 font-semibold mb-16">
                                <p>巡查使正在前往您的所在地</p>
                                <p>请勿离开该界面</p>
                            </div>
                            <div className="text-purple-100 space-y-3">
                                <p className="flex items-center justify-center gap-2 mb-2">
                                    ⚠️ 金绿猫眼权杖严正声明 ⚠️
                                </p>
                                <p className="text-xl flex items-center justify-center gap-2">
                                    城际网络并非法外之地
                                </p>
                            </div>
                        </div>
                    </div>

                    {shouldShowBackupSection && backupData && (
                        <div className="bg-purple-950/70 border border-pink-400/80 rounded-lg p-6 mb-8 shadow-2xl">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div>
                                    <div className="flex items-center gap-2 text-pink-200 text-lg font-semibold">
                                        <span>📁 输出触发敏感词，但输入已临时保存</span>
                                    </div>
                                    <p className="text-sm text-purple-100/80 mt-2">
                                        存档时间：{formatBackupTime(backupData.triggeredAt)} · 来源：{describeOrigin(backupData.origin)} · 触发原因：{backupData.reason || '使用危险符文'}
                                    </p>
                                    <p className="text-xs text-purple-100/70 mt-1">为避免再次丢失，请尽快下载所需资料并在本地妥善存储。</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleClearBackup}
                                    className="self-start rounded-md border border-pink-300/70 px-3 py-1 text-sm text-pink-100 hover:bg-pink-400/10"
                                >
                                    清空缓存
                                </button>
                            </div>

                            <div className="mt-5 space-y-4">
                                {backupData.items.map(item => (
                                    <div key={item.id} className="rounded-lg border border-purple-700/60 bg-purple-900/60 p-4">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <label className="flex flex-1 items-start gap-3 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1 h-4 w-4 accent-pink-400"
                                                    checked={Boolean(selectedItems[item.id])}
                                                    onChange={() => toggleSelection(item.id)}
                                                />
                                                <div>
                                                    <p className="font-semibold text-white">{item.label}</p>
                                                    <p className="text-xs text-purple-100/80 break-words">
                                                        {item.filename} · {formatSize(item.size)}{item.description ? ` · ${item.description}` : ''}
                                                    </p>
                                                </div>
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    className="rounded-md border border-pink-200/70 px-3 py-1 text-sm text-pink-100 hover:bg-pink-400/10"
                                                    onClick={() => downloadItem(item)}
                                                >
                                                    单独下载
                                                </button>
                                                <button
                                                    type="button"
                                                    className="rounded-md border border-purple-300/60 px-3 py-1 text-sm text-purple-100 hover:bg-purple-400/10"
                                                    onClick={() => handlePreviewToggle(item.id)}
                                                >
                                                    {previewItemId === item.id ? '收起预览' : '查看内容'}
                                                </button>
                                            </div>
                                        </div>
                                        {previewItemId === item.id && (
                                            <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-left font-mono text-purple-50 whitespace-pre-wrap">
                                                {item.content}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-start">
                                <button
                                    type="button"
                                    onClick={handleDownloadSelected}
                                    disabled={!hasSelectedItems}
                                    className={`rounded-md px-4 py-2 text-sm font-semibold shadow ${hasSelectedItems ? 'bg-pink-500 text-white hover:bg-pink-400' : 'bg-pink-200/30 text-pink-100 cursor-not-allowed'}`}
                                >
                                    下载选中项目（{selectedCount}）
                                </button>
                                <span className="text-xs text-purple-100/70">
                                    如果浏览器阻止下载，请逐个点击“单独下载”按钮。
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Magical footer warning */}
                    <div className="mt-8 text-center">
                        <div className="text-purple-300 text-sm" style={{ marginTop: '1rem' }}>
                            本逮捕令由魔法国度调查院授权发布
                        </div>
                    </div>
                </div>

                {/* --- 新闻滚动条UI --- */}
                {newsTickerItems.length > 0 && (
                    <div className="news-ticker-container">
                        <div className="news-ticker-content">
                            <span className="news-ticker-label">国度速报</span>
                            {/* 核心注释：
                              通过将 currentNewsIndex 作为 <p> 元素的 key，我们告诉 React 
                              每次索引变化时都应将此元素视为一个全新的元素。
                              这会强制重新渲染并重新触发 CSS 动画，从而实现每次都有进入和消失的效果。
                            */}
                            <p key={currentNewsIndex} className="news-ticker-item">
                                {newsTickerItems[currentNewsIndex]}
                            </p>
                        </div>
                    </div>
                )}

                {/* Custom animations */}
                <style jsx>{`
                  @keyframes float {
                    0%, 100% { transform: translateY(0px) rotate(0deg); }
                    50% { transform: translateY(-20px) rotate(180deg); }
                  }
                  .animate-float {
                    animation: float 4s ease-in-out infinite;
                  }
                  .news-ticker-container {
                      position: fixed;
                      bottom: 0;
                      left: 0;
                      width: 100%;
                      background-color: rgba(0, 0, 0, 0.5);
                      backdrop-filter: blur(5px);
                      color: #e9d5ff; /* 淡紫色文字 */
                      padding: 0.5rem 1rem;
                      font-size: 0.875rem; /* 14px */
                      z-index: 20;
                      overflow: hidden;
                      border-top: 1px solid rgba(233, 213, 255, 0.3);
                  }
                  .news-ticker-content {
                      display: flex;
                      align-items: center;
                      white-space: nowrap;
                  }
                  .news-ticker-label {
                      font-weight: 600;
                      color: #f3e8ff; /* 更亮的紫色 */
                      padding-right: 1rem;
                      margin-right: 1rem;
                      border-right: 1px solid rgba(233, 213, 255, 0.5);
                      flex-shrink: 0; /* 防止标签被压缩 */
                  }
                  .news-ticker-item {
                      margin: 0;
                      display: inline-block;
                      /* 动画组合：先滑入，停留4秒，然后淡出 */
                      animation: slideIn 0.5s ease-out forwards, fadeOut 0.5s ease-in 4.5s forwards;
                  }

                  /* 定义滑入动画 */
                  @keyframes slideIn {
                      from {
                          opacity: 0;
                          transform: translateY(100%);
                      }
                      to {
                          opacity: 1;
                          transform: translateY(0);
                      }
                  }

                  /* 定义淡出动画 */
                  @keyframes fadeOut {
                      from {
                          opacity: 1;
                          transform: translateY(0);
                      }
                      to {
                          opacity: 0;
                          transform: translateY(-100%);
                      }
                  }
                `}</style>
            </div>
        </>
    );
}
