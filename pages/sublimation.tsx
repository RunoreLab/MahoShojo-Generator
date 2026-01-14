// pages/sublimation.tsx

import React, { useState, ChangeEvent, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import MagicalGirlCard from '../components/MagicalGirlCard';
import CanshouCard from '../components/CanshouCard';
import GeneralCharacterCard from '../components/GeneralCharacterCard';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { useCooldown } from '../lib/cooldown';
import { config as appConfig } from '../lib/config';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import BattleDataModal from '../components/BattleDataModal';
import { useAuth } from '@/lib/useAuth';
import AiProviderSelector, { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import {
	    inferTemplate,
	    TEMPLATE_LABELS,
	    type DataCardTemplate,
    type InferableTemplate
} from '@/lib/data-card-converter';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

// 颜色处理方案
const MainColor = {
    Red: '红色',
    Orange: '橙色',
    Cyan: '青色',
    Blue: '蓝色',
    Purple: '紫色',
    Pink: '粉色',
    Yellow: '黄色',
    Green: '绿色'
} as const;

const gradientColors: Record<string, { first: string; second: string }> = {
    [MainColor.Red]: { first: '#ff6b6b', second: '#ee5a6f' },
    [MainColor.Orange]: { first: '#ff922b', second: '#ffa94d' },
    [MainColor.Cyan]: { first: '#22b8cf', second: '#66d9e8' },
    [MainColor.Blue]: { first: '#5c7cfa', second: '#748ffc' },
    [MainColor.Purple]: { first: '#9775fa', second: '#b197fc' },
    [MainColor.Pink]: { first: '#ff9a9e', second: '#fecfef' },
    [MainColor.Yellow]: { first: '#f59f00', second: '#fcc419' },
    [MainColor.Green]: { first: '#51cf66', second: '#8ce99a' }
};

type SupportedTargetTemplate = 'magical-girl' | 'canshou' | 'general';

const TARGET_TEMPLATE_OPTIONS: SupportedTargetTemplate[] = ['magical-girl', 'canshou', 'general'];

const TARGET_TEMPLATE_LABELS: Record<SupportedTargetTemplate, string> = {
    'magical-girl': TEMPLATE_LABELS['magical-girl'],
    'canshou': TEMPLATE_LABELS['canshou'],
    'general': TEMPLATE_LABELS['general'],
};

// 递归提取对象中所有字符串值的函数
const extractTextForCheck = (data: any): string => {
    let textContent = '';
    if (typeof data === 'string') {
        textContent += data + ' ';
    } else if (Array.isArray(data)) {
        data.forEach(item => {
            textContent += extractTextForCheck(item);
        });
    } else if (typeof data === 'object' && data !== null) {
        for (const key in data) {
            if (key !== 'signature' && key !== 'userAnswers') {
                textContent += extractTextForCheck(data[key]);
            }
        }
    }
    return textContent;
};

// API响应和结果状态的类型
interface SublimationResponse {
    sublimatedData: any;
    unchangedFields: string[];
    targetTemplate?: SupportedTargetTemplate;
}

// [新增] 定义可配置的字段及其显示名称
const PRESERVABLE_FIELDS_CONFIG: Record<SupportedTargetTemplate, { id: string; label: string }[]> = {
    'magical-girl': [
        { id: 'appearance', label: '外观' },
        { id: 'magicConstruct', label: '魔装' },
        { id: 'wonderlandRule', label: '奇境' },
        { id: 'blooming', label: '繁开' },
        { id: 'analysis', label: '分析' },
        { id: 'userAnswers', label: '问卷答案' },
    ],
    'canshou': [
        { id: 'appearance', label: '外貌形态' },
        { id: 'coreConcept', label: '核心概念' },
        { id: 'coreEmotion', label: '核心情感' },
        { id: 'materialAndSkin', label: '材质表皮' },
        { id: 'featuresAndAppendages', label: '特征附属' },
        { id: 'attackMethod', label: '攻击方式' },
        { id: 'specialAbility', label: '特殊能力' },
        { id: 'origin', label: '起源' },
        { id: 'birthEnvironment', label: '诞生环境' },
        { id: 'researcherNotes', label: '研究员笔记' },
        { id: 'userAnswers', label: '问卷答案' },
    ],
    'general': [
        { id: 'name', label: '角色名称' },
        { id: 'content', label: '完整设定（content）' }
    ]
};

const FIELD_PRESET_CONFIG: Record<SupportedTargetTemplate, { default: string[]; personality: string[] }> = {
    'magical-girl': {
        default: ['wonderlandRule', 'blooming'],
        personality: ['appearance', 'magicConstruct', 'wonderlandRule', 'blooming']
    },
    'canshou': {
        default: [],
        personality: ['appearance', 'materialAndSkin', 'featuresAndAppendages', 'attackMethod', 'specialAbility']
    },
    'general': {
        default: [],
        personality: ['name']
    }
};

const getDefaultPreserveFields = (target: SupportedTargetTemplate) => [...FIELD_PRESET_CONFIG[target].default];
const getPersonalityPreset = (target: SupportedTargetTemplate) => [...FIELD_PRESET_CONFIG[target].personality];
const getDefaultTargetTemplate = (source: InferableTemplate): SupportedTargetTemplate => {
    if (source === 'magical-girl') return 'magical-girl';
    if (source === 'canshou') return 'canshou';
    if (source === 'general') return 'general';
    return 'general';
};

const SUBLIMATION_STATE_PREF_KEY = 'sublimation-history-state-preferences-v1';


const SublimationPage: React.FC = () => {
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const [characterData, setCharacterData] = useState<any>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resultData, setResultData] = useState<SublimationResponse | null>(null);
    const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
    const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
    const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);
    const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [pastedJson, setPastedJson] = useState('');
    const [isPasteAreaVisible, setIsPasteAreaVisible] = useState(false);
    const [userGuidance, setUserGuidance] = useState('');

    // 数据库选择相关状态
    const [showBattleDataModal, setShowBattleDataModal] = useState(false);
    const [modalType, setModalType] = useState<'character' | 'scenario'>('character');

    // [新增] 用于管理高级选项的状态
    const [fieldsToPreserve, setFieldsToPreserve] = useState<string[]>([]);
    const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);
    const [allowReshapeNames, setAllowReshapeNames] = useState(false);
    const [isDowngrade] = useState(false); // 是否使用轻量模型
    const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
    const [targetTemplate, setTargetTemplate] = useState<SupportedTargetTemplate>('magical-girl');
    const [sourceTemplate, setSourceTemplate] = useState<InferableTemplate>('unknown');
    const [readArenaHistory, setReadArenaHistory] = useState(true);
    const [writeArenaHistory, setWriteArenaHistory] = useState(true);
    const [readCurrentState, setReadCurrentState] = useState(true);
    const [writeCurrentState, setWriteCurrentState] = useState(true);

    const isUserCustomKey = userProviderConfig?.providerId !== 'system' && !!userProviderConfig?.apiKey?.trim();
    const sublimationCooldownMs = isUserCustomKey ? 3000 : 60000;
    const sublimationCooldownKey = isUserCustomKey ? 'sublimationCooldown:custom' : 'sublimationCooldown:system';
    const { isCooldown, startCooldown, remainingTime } = useCooldown(sublimationCooldownKey, sublimationCooldownMs);
    const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

    const streamedGeneralCardForDisplay = useMemo(() => {
        if (generationMode !== 'stream') return null;
        const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? null;
        if (markdown === null) return null;

        const fallbackName =
            typeof (characterData as any)?.codename === 'string'
                ? String((characterData as any).codename).trim()
                : typeof (characterData as any)?.name === 'string'
                    ? String((characterData as any).name).trim()
                    : '';

        const defaultName = sourceTemplate === 'magical-girl'
            ? '魔法少女'
            : sourceTemplate === 'canshou'
                ? '残兽'
                : '角色';

        const { card } = buildGeneralCharacterCardFromMarkdown({
            markdown,
            fallbackName,
            defaultName,
        });

        return card;
    }, [generationMode, streamingMarkdown, streamedGeneralCard, characterData, sourceTemplate]);

    useEffect(() => {
        fetch('/languages.json').then(res => res.json()).then(data => setLanguages(data));
        const isMobileDevice = /mobile/i.test(navigator.userAgent);
        if (isMobileDevice) setIsPasteAreaVisible(true);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = window.localStorage.getItem(SUBLIMATION_STATE_PREF_KEY);
            if (!saved) return;
            const parsed = JSON.parse(saved);
            if (typeof parsed.readArenaHistory === 'boolean') setReadArenaHistory(parsed.readArenaHistory);
            if (typeof parsed.writeArenaHistory === 'boolean') setWriteArenaHistory(parsed.writeArenaHistory);
            if (typeof parsed.readCurrentState === 'boolean') setReadCurrentState(parsed.readCurrentState);
            if (typeof parsed.writeCurrentState === 'boolean') setWriteCurrentState(parsed.writeCurrentState);
        } catch (error) {
            console.warn('Failed to load sublimation preferences', error);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const payload = {
            readArenaHistory,
            writeArenaHistory,
            readCurrentState,
            writeCurrentState,
        };
        window.localStorage.setItem(SUBLIMATION_STATE_PREF_KEY, JSON.stringify(payload));
    }, [readArenaHistory, writeArenaHistory, readCurrentState, writeCurrentState]);

    useEffect(() => {
        setFieldsToPreserve(prev => {
            const allowed = new Set(PRESERVABLE_FIELDS_CONFIG[targetTemplate].map(item => item.id));
            return prev.filter(field => allowed.has(field));
        });
    }, [targetTemplate]);

    const processJsonData = (jsonText: string) => {
        try {
            const json = JSON.parse(jsonText);
            setCharacterData(json);
            setFileName('粘贴的内容');
            setError(null);
            setResultData(null);
            setAllowReshapeNames(false);

            const inferred = inferTemplate(json);
            setSourceTemplate(inferred);

            const defaultTarget = getDefaultTargetTemplate(inferred);
            setTargetTemplate(defaultTarget);
            setFieldsToPreserve(getDefaultPreserveFields(defaultTarget));

            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : '无法解析文件。';
            setError(`❌ 数据加载失败: ${message}`);
            setCharacterData(null);
            setFileName(null);
            return false;
        }
    };

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.type !== 'application/json') {
            setError('❌ 文件必须是 .json 格式。');
            return;
        }
        const text = await file.text();
        if (processJsonData(text)) {
            setFileName(file.name);
        }
        event.target.value = '';
    };

    const handlePasteAndLoad = () => {
        if (!pastedJson.trim()) {
            setError('⚠️ 文本框内容为空。');
            return;
        }
        if (processJsonData(pastedJson)) {
            setPastedJson('');
        }
    };

    // 打开角色数据卡选择器
    const handleOpenCharacterDataModal = () => {
        setShowBattleDataModal(true);
    };

    const handleTargetTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value as SupportedTargetTemplate;
        if (!TARGET_TEMPLATE_OPTIONS.includes(value)) return;
        setTargetTemplate(value);

        const isCrossTemplateSelection = Boolean(characterData && sourceTemplate !== value);
        if (isCrossTemplateSelection) {
            setFieldsToPreserve([]);
            return;
        }

        setFieldsToPreserve(getDefaultPreserveFields(value));
    };

    // 递归删除以 _ 开头的键
    const removePrivateKeys = (obj: any): any => {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(removePrivateKeys);
        }

        const cleaned: any = {};
        for (const key in obj) {
            if (!key.startsWith('_')) {
                cleaned[key] = removePrivateKeys(obj[key]);
            }
        }
        return cleaned;
    };

    // 处理从数据库选择的角色数据卡
    const handleSelectDataCard = async (card: any) => {
        try {
            // =================================================================
            // 【核心修正】
            // 错误原因：原代码错误地认为从模态框返回的 card 对象还包含一个 .data 属性，
            //           因此尝试执行 `JSON.parse(card.data)`，但此时 card.data 是 undefined，
            //           导致后续逻辑中处理的角色数据为 undefined，从而引发崩溃。
            // 解决方案：直接使用从模态框回调函数中接收到的 card 对象本身，因为它已经是
            //           我们需要的、解析好的完整角色数据。
            // =================================================================
            const cardData = card; // 直接使用回调对象，不再访问 .data

            // 删除内部使用的私有键（以_开头）
            const cleanedCardData = removePrivateKeys(cardData);

            setCharacterData(cleanedCardData);
            setFileName(`${card._cardName || '未命名'}(来自数据库)`); // 使用内部传递的_cardName
            setShowBattleDataModal(false);
            setError(null);
            setAllowReshapeNames(false);

            const inferred = inferTemplate(cleanedCardData);
            setSourceTemplate(inferred);
            const defaultTarget = getDefaultTargetTemplate(inferred);
            setTargetTemplate(defaultTarget);
            setFieldsToPreserve(getDefaultPreserveFields(defaultTarget));

        } catch (err) {
            setError(`❌ 数据卡加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
    };

    const handleGenerate = async () => {
        if (isCooldown) {
            setError(`操作过于频繁，请等待 ${remainingTime} 秒后再试。`);
            return;
        }
        if (!characterData) {
            setError('⚠️ 请先上传一个角色设定文件。');
            return;
        }
        if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey) {
            setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
            return;
        }
        setIsGenerating(true);
        setError(null);
        setResultData(null);
        setStreamingMarkdown(null);
        setStreamedGeneralCard(null);

	        try {
	            const textToCheck = extractTextForCheck(characterData) + " " + userGuidance;
	            const redirectTarget = await getSensitiveWordRedirectTarget(textToCheck, {
	                reason: '上传的角色档案或引导内容包含危险符文',
	            });
	            if (redirectTarget) {
	                router.push(redirectTarget);
	                return;
	            }

            const allowedFieldSet = new Set(currentFieldsConfig.map(item => item.id));
            const filteredFieldsToPreserve = fieldsToPreserve.filter(field => allowedFieldSet.has(field));

            const payload: Record<string, any> = {
                ...characterData,
                language: selectedLanguage,
                userGuidance: userGuidance.trim(),
                fieldsToPreserve: filteredFieldsToPreserve,
                allowReshapeNames,
                isDowngrade: isDowngrade,
                targetTemplate: targetTemplate,
                readArenaHistory,
                writeArenaHistory,
                readCurrentState,
                writeCurrentState,
                customProvider: (
                    userProviderConfig
                    && (userProviderConfig.apiKey || userProviderConfig.providerId === 'system')
                    && userProviderConfig.modelId !== 'default'
                ) ? {
                    providerId: userProviderConfig.providerId,
                    modelId: userProviderConfig.modelId,
                    apiKey: userProviderConfig.apiKey,
                } : undefined,
            };

            if (sourceTemplate !== 'unknown') {
                payload.sourceTemplate = sourceTemplate;
            }

            const endpoint = generationMode === 'stream' ? '/api/generate-sublimation-stream' : '/api/generate-sublimation';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorJson = await response.json().catch(() => null as any);
                if (errorJson?.shouldRedirect) {
                    router.push({
                        pathname: '/arrested',
                        query: { reason: errorJson.reason || '使用危险符文' }
                    });
                    return;
                }
                const serverMessage = errorJson?.message || errorJson?.error;
                throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `升华失败（HTTP ${response.status}）`);
            }

            if (generationMode === 'stream') {
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                if (contentType.includes('application/json') || contentType.includes('+json')) {
                    const errorJson = await response.json().catch(() => null as any);
                    const serverMessage = errorJson?.message || errorJson?.error;
                    throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `升华失败（HTTP ${response.status}）`);
                }

                setStreamingMarkdown('');
                const markdown = await readTextStreamFromResponse(response, {
                    label: '升华（流式）',
                    onText: (text) => setStreamingMarkdown(text),
                });

                const fallbackName =
                    typeof (characterData as any)?.codename === 'string'
                        ? String((characterData as any).codename).trim()
                        : typeof (characterData as any)?.name === 'string'
                            ? String((characterData as any).name).trim()
                            : '';

                const defaultName = sourceTemplate === 'magical-girl'
                    ? '魔法少女'
                    : sourceTemplate === 'canshou'
                        ? '残兽'
                        : '角色';

                const { card } = buildGeneralCharacterCardFromMarkdown({
                    markdown,
                    fallbackName,
                    defaultName,
                });

                setStreamedGeneralCard(card);
                startCooldown();
                return;
            }

            const result: SublimationResponse = await response.json();
            if (result.targetTemplate && TARGET_TEMPLATE_OPTIONS.includes(result.targetTemplate)) {
                setTargetTemplate(result.targetTemplate);
            }
            setResultData(result);
            startCooldown();

        } catch (err) {
            const message = err instanceof Error ? err.message : '发生未知错误';
            setError(`✨ 升华失败！${message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSaveImage = (imageUrl: string) => {
        setSavedImageUrl(imageUrl);
        setShowImageModal(true);
    };

    const downloadJson = (data: any) => {
        const name = data.codename || data.name;
        const jsonData = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `角色档案_${name}_升华.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleOptionalFieldChange = (fieldId: string) => {
        setFieldsToPreserve(prev =>
            prev.includes(fieldId)
                ? prev.filter(f => f !== fieldId)
                : [...prev, fieldId]
        );
    };

    const applyPreset = (presetName: 'default' | 'full' | 'personality') => {
        switch (presetName) {
            case 'default':
                setFieldsToPreserve(getDefaultPreserveFields(targetTemplate));
                break;
            case 'full':
                setFieldsToPreserve([]);
                break;
            case 'personality':
                setFieldsToPreserve(getPersonalityPreset(targetTemplate));
                break;
        }
    };

    const renderResultCard = () => {
        if (!resultData?.sublimatedData) return null;
        const data = resultData.sublimatedData;

        if (targetTemplate === 'magical-girl' && data.codename) {
            const colorScheme = data.appearance.colorScheme || "红色、粉色";
            const mainColorName = Object.values(MainColor).find(color => colorScheme.includes(color)) || MainColor.Pink;
            const colors = gradientColors[mainColorName] || gradientColors[MainColor.Pink];
            const gradientStyle = `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
            return <MagicalGirlCard magicalGirl={data} gradientStyle={gradientStyle} onSaveImage={handleSaveImage} />;
        } else if (targetTemplate === 'canshou' && data.name && data.templateId !== GENERAL_CHARACTER_TEMPLATE_ID) {
            return <CanshouCard canshou={data} onSaveImage={handleSaveImage} />;
        } else if (targetTemplate === 'general') {
            return <GeneralCharacterCard general={data} />;
        }
        return (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                升华结果已生成，可通过“下载新设定”查看完整 JSON。当前模板不支持在页面内预览。
            </div>
        );
    };

    const sourceTemplateLabel = sourceTemplate === 'unknown'
        ? '未识别模板'
        : TEMPLATE_LABELS[sourceTemplate as DataCardTemplate];
    const targetTemplateLabel = TARGET_TEMPLATE_LABELS[targetTemplate];
    const hasCrossTemplateSelection = Boolean(characterData && sourceTemplate !== targetTemplate);
    const currentFieldsConfig = PRESERVABLE_FIELDS_CONFIG[targetTemplate];

    return (
        <>
            <Head>
                <title>成长升华 - MahoShojo Generator</title>
                <meta name="description" content="根据角色的历战记录，生成一个全新的成长后形态！" />
            </Head>
            <div className="magic-background-white">
                <div className="container">
                    <div className="card">
                        <div className="text-center mb-4">
                            <div className="flex justify-center items-center" style={{ marginBottom: '1rem' }}>
                                <img src="/sublimation.svg" width={360} height={40} alt="角色成长升华" />
                            </div>
                            <p className="subtitle mt-2">角色成长升华，见证她们在战斗与经历中完成的蜕变</p>
                        </div>
                        <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
                            <h3 className="font-bold mb-2">✨ 功能说明</h3>
                            <ol className="list-decimal list-inside space-y-1">
                                <li>上传任意.json格式的设定文件（部分兼容非规范文件），历战记录 <span className="font-semibold">可选</span>，如存在会增强升华叙事。</li>
                                <li>选择目标模板（默认沿用原模板，无匹配时自动切换为通用角色），并可指定需要保留的字段。如果希望借此切换角色模板，建议选择【完全重塑】。</li>
                                <li>AI 将结合设定、历战记录与可选的成长引导，生成“升华后”的新形态设定。</li>
                            </ol>
                            <div className="mt-3 flex flex-wrap gap-3 text-xs">
                                <Link href="/encyclopedia/sublimation" className="text-blue-700 hover:underline">百科：成长升华</Link>
                                <Link href="/encyclopedia/sensitive-words" className="text-blue-700 hover:underline">敏感词与逮捕（含恢复）</Link>
                                <Link href="/encyclopedia/shield-words" className="text-blue-700 hover:underline">屏蔽词（和谐替换）</Link>
                                <Link href="/encyclopedia/archive" className="text-blue-700 hover:underline">档案馆（角色管理）</Link>
                            </div>
                        </div>

                        {/* 文件上传与粘贴区域 */}
                        <div className="input-group">
                            <label htmlFor="character-upload" className="input-label">上传设定文件</label>
                            <input id="character-upload" type="file" accept=".json" onChange={handleFileChange} className="input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
                            {fileName && (<p className="text-xs text-gray-500 mt-2">已加载角色: {fileName}</p>)}
                        </div>
                        <div className="mb-6">
                            <button onClick={() => setIsPasteAreaVisible(!isPasteAreaVisible)} className="text-purple-700 hover:underline cursor-pointer mb-2 font-semibold">
                                {isPasteAreaVisible ? '▼ 折叠文本粘贴区域' : '▶ 展开文本粘贴区域 (手机端推荐)'}
                            </button>
                            {isPasteAreaVisible && (
                                <div className="input-group mt-2">
                                    <textarea value={pastedJson} onChange={(e) => setPastedJson(e.target.value)} placeholder="在此处粘贴一个设定文件(.json)内容" className="input-field resize-y h-32" />
                                    <button onClick={handlePasteAndLoad} disabled={isGenerating} className="generate-button mt-2 mb-0" style={{ backgroundColor: '#8b5cf6', backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)' }}>从文本加载设定</button>
                                </div>
                            )}
                        </div>

                        {/* 数据库选择区域 */}
                        <div className="mb-6">
                            <h3 className="input-label">从数据库选择角色</h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleOpenCharacterDataModal}
                                    disabled={isGenerating}
                                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    从在线角色数据库中选择
                                </button>
                                <select
                                    value={modalType}
                                    onChange={(e) => setModalType(e.target.value as 'character' | 'scenario')}
                                    className="flex-1 input-field"
                                    disabled={isGenerating}
                                >
                                    <option value="character">角色/残兽/通用</option>
                                    <option value="scenario">情景 (Scenario)</option>
                                </select>
                            </div>
                            {!isAuthenticated && (
                                <p className="text-xs text-gray-500 mt-1">
                                    <Link
                                        href="/character-manager"
                                        className="text-purple-600 hover:text-purple-800 underline"
                                    >
                                        登录
                                    </Link>
                                    后可访问私有数据卡与收藏夹。
                                </p>
                            )}
                            {isAuthenticated && (
                                <p className="text-xs text-gray-500 mt-1">
                                    支持任意设定素材；默认会引用档案中的历战记录，可在下方“资料读写策略”中关闭读取或写入。
                                </p>
                            )}
                        </div>

                        {/* 目标模板选择 */}
                        <div className="input-group">
                            <label className="input-label">升华目标模板</label>
                            <select
                                value={targetTemplate}
                                onChange={handleTargetTemplateChange}
                                className="input-field"
                                disabled={isGenerating || !characterData}
                            >
                                {TARGET_TEMPLATE_OPTIONS.map(option => (
                                    <option key={option} value={option}>
                                        {TARGET_TEMPLATE_LABELS[option]}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">
                                当前素材识别为：<span className="font-semibold">{sourceTemplateLabel}</span>；默认根据该模板选择目标，可手动尝试跨模板升华。
                            </p>
                            {hasCrossTemplateSelection && (
                                <p className="text-xs text-purple-600 mt-1">
                                    检测到从 {sourceTemplateLabel} 升华为 {targetTemplateLabel}，系统已自动取消所有“保留字段”，AI 将完全重塑设定。
                                </p>
                            )}
                            {targetTemplate === 'general' && (
                                <p className="text-xs text-blue-600 mt-1">
                                    通用角色的 <code>content</code> 字段将承载全部设定，AI 会输出结构化 Markdown 方便继续创作。
                                </p>
                            )}
                        </div>

                        {/* 成长方向引导输入框 */}
                        <div className="input-group">
                            <label htmlFor="user-guidance" className="input-label">成长方向引导 (可选)</label>
                            <input id="user-guidance" type="text" value={userGuidance} onChange={(e) => setUserGuidance(e.target.value)} className="input-field" placeholder="输入关键词或一句话 (最多30字)" maxLength={30} disabled={isGenerating} />
                            {userGuidance && appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING ? (
                                <p className="text-xs text-green-700 mt-1">✅ 管理员已允许引导升华保留原生签名。</p>
                            ) : (
                                <p className="text-xs text-yellow-700 mt-1">⚠️ 注意: 提供引导将使生成的角色变为“衍生数据”，并移除其原生签名。</p>
                            )}
                        </div>

                        {/* 历战记录 / 当前状态策略 */}
                        <div className="input-group">
                            <label className="input-label">资料读写策略</label>
                            <div className="grid gap-4 md:grid-cols-2">
                                <fieldset className="border border-gray-200 rounded-lg p-3">
                                    <legend className="text-xs font-semibold text-gray-600 px-1">历战记录</legend>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
                                            checked={readArenaHistory}
                                            onChange={(e) => setReadArenaHistory(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        升华时读取
                                    </label>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
                                            checked={writeArenaHistory}
                                            onChange={(e) => setWriteArenaHistory(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        升华后写入
                                    </label>
                                    <p className="text-[11px] text-gray-500 mt-1">关闭读取后，仅根据设定与引导完成升华；关闭写入后，本次升华不会新增历史条目。</p>
                                </fieldset>
                                <fieldset className="border border-gray-200 rounded-lg p-3">
                                    <legend className="text-xs font-semibold text-gray-600 px-1">当前状态</legend>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
                                            checked={readCurrentState}
                                            onChange={(e) => setReadCurrentState(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        升华时读取
                                    </label>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
                                            checked={writeCurrentState}
                                            onChange={(e) => setWriteCurrentState(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        升华后写入
                                    </label>
                                    <p className="text-[11px] text-gray-500 mt-1">当前状态用于追踪角色即时状况。开启写入后，AI 只会更新摘要，保留你自定义的字段。</p>
                                </fieldset>
                            </div>
                        </div>

                        {/* [新增] 高级选项UI */}
                        <div className="input-group mt-6">
                            <button onClick={() => setIsAdvancedVisible(!isAdvancedVisible)} className="text-sm font-semibold text-purple-700 hover:underline focus:outline-none">
                                {isAdvancedVisible ? '▼ ' : '▶ '}高级选项：自定义升华范围
                            </button>
                            {isAdvancedVisible && characterData && (
                                <div className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                                    <p className="text-xs text-gray-600 mb-3">勾选你希望<span className="font-bold">保留不变</span>的字段，未勾选的字段将由AI重塑。</p>
                                    {targetTemplate === 'magical-girl' && (
                                        <div className="mb-4 rounded-lg border border-purple-200 bg-white/70 p-3">
                                            <label className="flex items-center text-sm cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={allowReshapeNames}
                                                    onChange={(event) => setAllowReshapeNames(event.target.checked)}
                                                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                />
                                                <span className="ml-2 text-gray-700">重塑名称（魔装 / 奇境 / 繁开）</span>
                                            </label>
                                            <p className="text-[11px] text-gray-500 mt-1">
                                                默认会保留上述 <code>name</code> 字段；开启后允许 AI 也对其进行“改名/追加称号”。
                                            </p>
                                        </div>
                                    )}
                                    {targetTemplate === 'general' && (
                                        <p className="text-xs text-blue-700 mb-3">
                                            提醒：<code>content</code> 字段包含角色的全部设定（外观、能力、背景、经历等）。如需完整改写，请取消勾选。
                                        </p>
                                    )}
                                    <div className="mb-4 flex flex-wrap gap-2">
                                        <button onClick={() => applyPreset('default')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">默认</button>
                                        <button onClick={() => applyPreset('full')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">完全重塑</button>
                                        <button onClick={() => applyPreset('personality')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">仅心灵成长</button>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {currentFieldsConfig.map(field => (
                                            <label key={field.id} className="flex items-center text-sm cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={fieldsToPreserve.includes(field.id)}
                                                    onChange={() => handleOptionalFieldChange(field.id)}
                                                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                />
                                                <span className="ml-2 text-gray-700">{field.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 多语言支持 */}
                        <div className="input-group">
                            <label htmlFor="language-select" className="input-label">
                                <img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />
                                生成语言
                            </label>
                            <select
                                id="language-select"
                                value={selectedLanguage}
                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                className="input-field"
                                disabled={isGenerating}
                            >
                                {languages.map(lang => (
                                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="input-group">
                            <GenerationModeSwitcher
                                label="生成方式"
                                value={generationMode}
                                disabled={isGenerating}
                                helper={false}
                                onChange={(mode) => setGenerationMode(mode)}
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                {generationMode === 'stream'
                                    ? '提示：选择流式生成后，将实时输出 Markdown，并生成【通用角色卡】（templateId=通用角色）。代号/名字会尝试从输出中解析，失败则回退到原卡名称或“角色”。'
                                    : '提示：非流式生成会返回结构化数据卡（按目标模板输出），更适合继续升华/编辑。'}
                            </p>
                        </div>

                        {/* 自定义 AI 模型选择 */}
                        <AiProviderSelector onConfigChange={setUserProviderConfig} />

                        {/* 成功提示信息 */}
                        {!isGenerating && generationMode === 'non-stream' && resultData && (
                            <div className="text-center text-sm text-green-600 my-2 font-semibold">
                                🎉 升华成功！结果已显示在下方，请下滑查看。
                            </div>
                        )}
                        {!isGenerating && generationMode === 'stream' && streamedGeneralCard && (
                            <div className="text-center text-sm text-green-600 my-2 font-semibold">
                                🎉 升华成功！已生成通用角色卡（流式），请下滑查看。
                            </div>
                        )}

                        {/* 更新按钮状态和文本 */}
                        <button onClick={handleGenerate} disabled={isGenerating || !characterData || isCooldown} className="generate-button mt-4">
                            {isCooldown ? `冷却中 (${remainingTime}s)` : isGenerating ? '升华中...' : '开始升华'}
                        </button>
                        {error && <ErrorMessage message={error} className="error-message mt-4" />}
                    </div>

                    {isGenerating && <div className="text-center mt-6">少女蜕变中，请稍后...</div>}

                    {generationMode === 'stream' && (streamingMarkdown !== null || streamedGeneralCard) && (
                        <>
                            {streamedGeneralCardForDisplay && (
                                <div className="card mt-6">
                                    <GeneralCharacterCard
                                        general={streamedGeneralCardForDisplay}
                                        onSaveImage={handleSaveImage}
                                        isStreaming={isGenerating}
                                    />
                                    <p className="mt-3 text-xs text-gray-500 text-center">
                                        提示：流式模式生成的是通用角色卡（Markdown），不保证与目标模板字段一一对应。
                                    </p>
                                </div>
                            )}

                            {streamedGeneralCard && (
                                <div className="card mt-6 text-center">
                                    <h3 className="text-lg font-bold text-gray-800 mb-3">操作</h3>
                                    <div className="flex flex-col md:flex-row justify-center">
                                        <button onClick={() => downloadJson(streamedGeneralCard)} className="generate-button flex-1">
                                            下载通用角色卡
                                        </button>
                                        <SaveToCloudButton
                                            data={streamedGeneralCard}
                                            cardType="character"
                                            buttonText="保存到云端"
                                            className="generate-button flex-1"
                                            style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                                        />
                                        <Link href="/battle" className="generate-button flex-1" style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)', textDecoration: 'none' }}>
                                            前往竞技场
                                        </Link>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {generationMode === 'non-stream' && resultData && (
                        <>
                            {resultData.unchangedFields && resultData.unchangedFields.length > 0 && (
                                <div className="card mt-6 bg-blue-50 border border-blue-200">
                                    <h4 className="font-bold text-blue-800 mb-2">升华报告</h4>
                                    <p className="text-sm text-blue-700">AI 已根据角色经历更新设定，但以下字段保留原始设定：</p>
                                    <ul className="list-disc list-inside text-xs text-blue-600 mt-2 pl-2">
                                        {resultData.unchangedFields.map(field => <li key={field}>{field}</li>)}
                                    </ul>
                                </div>
                            )}
                            {renderResultCard()}
                            <div className="card mt-6 text-center">
                                <h3 className="text-lg font-bold text-gray-800 mb-3">操作</h3>
                                <div className="flex flex-col md:flex-row justify-center">
                                    <button onClick={() => downloadJson(resultData.sublimatedData)} className="generate-button flex-1">
                                        下载新设定
                                    </button>
                                    <SaveToCloudButton
                                        data={resultData.sublimatedData}
                                        buttonText="保存到云端"
                                        className="generate-button flex-1"
                                        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                                    />
                                    <Link href="/battle" className="generate-button flex-1" style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)', textDecoration: 'none' }}>
                                        前往竞技场
                                    </Link>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="text-center" style={{ marginTop: '2rem' }}>
                        <Link href="/" className="footer-link">返回首页</Link>
                    </div>
                </div>

                {showImageModal && savedImageUrl && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
                            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur flex justify-end p-2">
                                <button
                                    onClick={() => setShowImageModal(false)}
                                    aria-label="关闭"
                                    className="text-3xl leading-none text-gray-600 hover:text-gray-900"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="px-4 pb-4">
                                <p className="text-center text-sm text-gray-600 mb-2">长按图片保存到相册</p>
                                <img src={savedImageUrl} alt="角色卡片" className="w-full h-auto rounded-lg" />
                            </div>
                        </div>
                    </div>
                )}
                <Footer />

                {/* 数据库数据选择模态框 */}
                <BattleDataModal
                    isOpen={showBattleDataModal}
                    onClose={() => setShowBattleDataModal(false)}
                    onSelectCard={handleSelectDataCard}
                    selectedType={modalType}
                />
            </div>
        </>
    );
};

export default SublimationPage;
