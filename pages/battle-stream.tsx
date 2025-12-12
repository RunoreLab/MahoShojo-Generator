// pages/battle-stream.tsx

import React, { useState, useRef, ChangeEvent, useEffect, useMemo, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCooldown } from '../lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import BattleReportCard, { NewsReport } from '../components/stream/BattleReportCard';
import Link from 'next/link';
import { Preset } from './api/get-presets';
import { StatsData } from './api/get-stats';
import Leaderboard from '../components/Leaderboard';
import { config as appConfig } from '../lib/config';
// v0.4.0 引入新的判定器类型
import { AdjudicatorEvent, AdjudicationResult, CharacterCurrentState } from '../types/arena';
import { generateRandomMagicalGirl, generateRandomCanshou } from '../lib/random-character-generator';
import BattleDataModal from '../components/BattleDataModal';
import { useAuth } from '@/lib/useAuth';
import Footer from '../components/Footer';
import SaveToCloudButton from '../components/SaveToCloudButton';
// v0.4.0 引入新的编辑器组件
import AdjudicatorEditor from '../components/AdjudicatorEditor';
import AiProviderSelector, { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { inferTemplate } from '@/lib/data-card-converter';
import { GeneralCharacterSchema } from '@/lib/schemas';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';

const ARENA_STATE_PREF_KEY = 'arena-history-state-preferences-v1';
const MAX_COMBATANTS = 10;

interface UpdatedCombatantData {
    codename?: string;
    name?: string;
    arena_history: any; // ArenaHistory;
    signature?: string;
    current_state?: CharacterCurrentState | null;
    // 允许包含角色文件的其他所有字段
    [key: string]: any;
}

interface BattleApiResponse {
    report: NewsReport;
    updatedCombatants: UpdatedCombatantData[];
    // v0.4.0 新增
    adjudicationResults?: AdjudicationResult[];
}

// 魔法少女设定核心字段（用于验证）
const MAGICAL_GIRL_CORE_FIELDS = {
    appearance: ['outfit', 'accessories', 'colorScheme', 'overallLook'],
    magicConstruct: ['name', 'form', 'basicAbilities', 'description'],
    wonderlandRule: ['name', 'description', 'tendency', 'activation'],
    blooming: ['name', 'evolvedAbilities', 'evolvedForm', 'evolvedOutfit', 'powerLevel'],
    analysis: ['personalityAnalysis', 'abilityReasoning', 'coreTraits', 'predictionBasis']
};

// 残兽设定核心字段（用于验证）
const CANSHOU_CORE_FIELDS = [
    'name', 'coreConcept', 'coreEmotion', 'evolutionStage', 'appearance',
    'materialAndSkin', 'featuresAndAppendages', 'attackMethod', 'specialAbility',
    'origin', 'birthEnvironment', 'researcherNotes'
];


// 定义可选的战斗等级
const battleLevels = [
    { value: '', label: '默认 (AI自动分配)' },
    { value: '种级', label: '种级 🌱' },
    { value: '芽级', label: '芽级 🍃' },
    { value: '叶级', label: '叶级 🌿' },
    { value: '蕾级', label: '蕾级 🌸' },
    { value: '花级', label: '花级 🌺' },
];

// 新增：定义随机角色占位符的类型
interface RandomCombatantPlaceholder {
    type: 'random-magical-girl' | 'random-canshou';
    id: string; // 使用唯一ID作为key
    filename: string; // 用于UI显示
}

// 定义参战者的数据结构
type CombatantType = 'magical-girl' | 'canshou' | 'general-character';

const COMBATANT_TYPE_LABELS: Record<CombatantType, string> = {
    'magical-girl': '魔法少女',
    canshou: '残兽',
    'general-character': '通用角色'
};

interface CombatantData {
    type: CombatantType;
    data: any;
    filename: string; // 用于UI显示和去重
    isValid: boolean; // 用于标记是否为原生设定
    isPreset: boolean; // 标记是否为预设角色
    isNonStandard?: boolean; // 标记是否为非规范格式
}

// 修改：让 Combatant 类型可以包含真实角色或占位符
type Combatant = (CombatantData | RandomCombatantPlaceholder) & { teamId?: number };

// 定义故事/战斗模式类型
type BattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';

interface SSEEventPayload {
    event: string;
    data: string;
}

const parseSSEEvent = (rawEvent: string): SSEEventPayload | null => {
    if (!rawEvent.trim()) {
        return null;
    }

    const lines = rawEvent.split('\n');
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
        }
    }

    if (dataLines.length === 0) {
        return null;
    }

    return {
        event: eventType,
        data: dataLines.join('\n'),
    };
};

const safeJsonParse = <T,>(input: string): T | null => {
    try {
        return JSON.parse(input) as T;
    } catch {
        return null;
    }
};

// 辅助函数：用于检测是否为旧版的随机判定器格式
// 通过检查数组中的对象是否包含旧的 'event' 和 'probability' 键，
// 并且不包含新格式特有的 'type' 键，来做出判断。
const isLegacyAdjudicatorFormat = (events: any[]): boolean => {
    if (!Array.isArray(events) || events.length === 0) {
        return false;
    }
    const firstEvent = events[0];
    return (
        typeof firstEvent === 'object' &&
        firstEvent !== null &&
        typeof firstEvent.event === 'string' &&
        typeof firstEvent.probability === 'number' &&
        typeof firstEvent.type === 'undefined'
    );
};

const BattlePage: React.FC = () => {
    const router = useRouter();
    const { isAuthenticated } = useAuth();

    // 统一存储所有参战者
    const [combatants, setCombatants] = useState<Combatant[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    // 错误或警告信息
    const [error, setError] = useState<string | null>(null);
    // 更新状态以匹配新的数据结构
    const [newsReport, setNewsReport] = useState<NewsReport | null>(null);
    const [liveArticleBody, setLiveArticleBody] = useState<string | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    // 保存的图片URL
    const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
    // 是否显示图片模态框
    const [showImageModal, setShowImageModal] = useState(false);
    // 用于复制粘贴角色设定文本
    const [pastedJson, setPastedJson] = useState<string>('');
    const [isPasteAreaVisible, setIsPasteAreaVisible] = useState(false);
    // 新增：用于复制粘贴情景设定文本
    const [pastedScenarioJson, setPastedScenarioJson] = useState('');
    const [isScenarioPasteAreaVisible, setIsScenarioPasteAreaVisible] = useState(false);

    // 数据库数据选择相关状态
    const [showBattleDataModal, setShowBattleDataModal] = useState(false);
    const [dataModalType, setDataModalType] = useState<'character' | 'scenario'>('character');

    // 用于跟踪哪些文件被自动修正过
    const [correctedFiles, setCorrectedFiles] = useState<Record<string, boolean>>({});
    // 用于跟踪复制操作的状态
    const [copiedStatus, setCopiedStatus] = useState<Record<string, boolean>>({});
    // 用于存储用户故事引导输入的状态
    const [userGuidance, setUserGuidance] = useState('');
    // 用于锁定正在加载的预设按钮的状态
    const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
    // 新增：用于控制是否使用历战记录的状态
    const [readArenaHistory, setReadArenaHistory] = useState(true);
    const [readArenaHistoryLimit, setReadArenaHistoryLimit] = useState('3');
    const [isArenaHistoryUnlimited, setIsArenaHistoryUnlimited] = useState(false);
    const [writeArenaHistory, setWriteArenaHistory] = useState(true);
    const [readCurrentState, setReadCurrentState] = useState(true);
    const [writeCurrentState, setWriteCurrentState] = useState(true);
    // 新增：用于控制是否使用轻量模型的状态（默认不启用）
    const [isDowngrade, setIsDowngrade] = useState(false);
    // 新增：用于管理自定义 AI 供应商配置
    const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);

    // 冷却状态钩子：官方120s，自定义Key缩短至3s
    const isUserCustomKey = userProviderConfig?.providerId !== 'system' && !!userProviderConfig?.apiKey?.trim();
    const battleStreamCooldownMs = isUserCustomKey ? 3000 : 120000;
    const battleStreamCooldownKey = isUserCustomKey ? 'generateBattleCooldown:custom' : 'generateBattleCooldown:system';
    const { isCooldown, startCooldown, remainingTime } = useCooldown(battleStreamCooldownKey, battleStreamCooldownMs);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = window.localStorage.getItem(ARENA_STATE_PREF_KEY);
            if (!saved) return;
            const parsed = JSON.parse(saved);
            if (typeof parsed.readArenaHistory === 'boolean') setReadArenaHistory(parsed.readArenaHistory);
            if (typeof parsed.readArenaHistoryLimit === 'string') setReadArenaHistoryLimit(parsed.readArenaHistoryLimit);
            if (typeof parsed.isArenaHistoryUnlimited === 'boolean') setIsArenaHistoryUnlimited(parsed.isArenaHistoryUnlimited);
            if (typeof parsed.writeArenaHistory === 'boolean') setWriteArenaHistory(parsed.writeArenaHistory);
            if (typeof parsed.readCurrentState === 'boolean') setReadCurrentState(parsed.readCurrentState);
            if (typeof parsed.writeCurrentState === 'boolean') setWriteCurrentState(parsed.writeCurrentState);
        } catch (error) {
            console.warn('Failed to load arena preferences', error);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const payload = {
            readArenaHistory,
            readArenaHistoryLimit,
            isArenaHistoryUnlimited,
            writeArenaHistory,
            readCurrentState,
            writeCurrentState,
        };
        window.localStorage.setItem(ARENA_STATE_PREF_KEY, JSON.stringify(payload));
    }, [readArenaHistory, readArenaHistoryLimit, isArenaHistoryUnlimited, writeArenaHistory, readCurrentState, writeCurrentState]);

    // 分别存储两种类型的预设
    const [magicalGirlPresets, setMagicalGirlPresets] = useState<Preset[]>([]);
    const [canshouPresets, setCanshouPresets] = useState<Preset[]>([]);
    const [isLoadingPresets, setIsLoadingPresets] = useState(true);

    // 分页状态
    const [currentMgPresetPage, setCurrentMgPresetPage] = useState(1);
    const [currentCanshouPresetPage, setCurrentCanshouPresetPage] = useState(1);
    const presetsPerPage = 4;

    // 状态：用于存储从API获取的统计数据
    const [stats, setStats] = useState<StatsData | null>(null);
    // 状态：用于存储用户选择等级的状态
    const [selectedLevel, setSelectedLevel] = useState<string>('');
    // 状态：用于存储预设角色的描述信息，方便在排行榜上显示
    const [presetInfo, setPresetInfo] = useState<Map<string, string>>(new Map());
    // 状态：用于显示加载状态
    const [isLoadingStats, setIsLoadingStats] = useState(true);

    // 模式状态
    const [battleMode, setBattleMode] = useState<BattleMode>('classic');

    // 语言选择状态
    const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

    // 用于存储情景模式下上传的情景文件内容
    const [scenarioContent, setScenarioContent] = useState<Record<string, unknown> | null>(null);
    const [scenarioFileName, setScenarioFileName] = useState<string | null>(null);

    // 用于追踪情景文件的原生性
    const [isScenarioNative, setIsScenarioNative] = useState<boolean>(false);

    // 用于存储从API返回的、更新了历战记录的角色数据
    const [updatedCombatants, setUpdatedCombatants] = useState<any[]>([]);

    // v0.4.0: 增强型判定器状态
    const [adjudicationEvents, setAdjudicationEvents] = useState<AdjudicatorEvent[]>([]);
    const [adjudicationResults, setAdjudicationResults] = useState<AdjudicationResult[] | null>(null);
    const [storyLength, setStoryLength] = useState('default');

    const upsertAdjudicationEvents = useCallback((incoming: AdjudicatorEvent[] | undefined) => {
        if (!Array.isArray(incoming) || incoming.length === 0) return;
        const buildKey = (evt: AdjudicatorEvent, idx: number) => (typeof evt?.id === 'string' && evt.id) || `${evt?.description || 'event'}-${idx}`;
        setAdjudicationEvents(prev => {
            const pairs = incoming.map((evt, idx) => ({ evt, key: buildKey(evt, idx) }));
            const incomingKeys = new Set(pairs.map(pair => pair.key));
            const filteredPrev = prev.filter((evt, idx) => !incomingKeys.has(buildKey(evt, idx)));
            return [...filteredPrev, ...pairs.map(pair => pair.evt)];
        });
    }, []);

    const appendAdjudicationEventsFromSource = useCallback((events: unknown, sourceLabel: string, options?: { warningState?: { warned: boolean }; onLegacyDiscard?: () => void }) => {
        if (!Array.isArray(events) || events.length === 0) return;
        const warningState = options?.warningState;
        if (isLegacyAdjudicatorFormat(events as any[])) {
            if (warningState) {
                if (!warningState.warned) {
                    setError(`⚠️ 文件 "${sourceLabel}" 包含旧版随机事件，已被忽略。请前往【角色管理中心】加载并保存该文件以自动升级格式。`);
                    warningState.warned = true;
                }
            } else {
                setError(`⚠️ 文件 "${sourceLabel}" 包含旧版随机事件，已被忽略。请前往【角色管理中心】加载并保存该文件以自动升级格式。`);
            }
            options?.onLegacyDiscard?.();
            return;
        }
        upsertAdjudicationEvents(events as AdjudicatorEvent[]);
    }, [setError, upsertAdjudicationEvents]);

    /**
     * @description 用于跟踪随机匹配功能的加载状态。
     * - null: 未在加载
     * - 'character': 正在随机匹配角色
     * - 'scenario': 正在随机匹配情景
     */
    const [isMatching, setIsMatching] = useState<string | null>(null);

    const scenarioDisplayName = useMemo<string | null>(() => {
        if (battleMode !== 'scenario') {
            return null;
        }
        const content = scenarioContent as Record<string, unknown> | null;
        if (content) {
            const maybeTitle = content['title'];
            if (typeof maybeTitle === 'string') {
                const trimmed = maybeTitle.trim();
                if (trimmed) {
                    return trimmed;
                }
            }
        }
        if (typeof scenarioFileName === 'string' && scenarioFileName.trim()) {
            return scenarioFileName.replace(/\.json$/i, '').trim();
        }
        return null;
    }, [battleMode, scenarioContent, scenarioFileName]);

    // 加载语言列表
    useEffect(() => {
        fetch('/languages.json')
            .then(res => res.json())
            .then(data => setLanguages(data))
            .catch(err => console.error("Failed to load languages:", err));
    }, []);

    // 检测移动端并默认展开文本域
    useEffect(() => {
        const isMobileDevice = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(navigator.userAgent.toLowerCase());
        if (isMobileDevice) {
            setIsPasteAreaVisible(true);
            setIsScenarioPasteAreaVisible(true); // 同样默认展开情景粘贴区
        }
    }, []);

    // 组件加载时获取预设角色列表和统计数据
    useEffect(() => {
        const fetchData = async () => {
            try {
                // 根据配置决定是否需要获取统计数据
                const shouldFetchStats = appConfig.SHOW_STAT_DATA;

                // 构建请求数组
                const requests = [fetch('/api/get-presets')];
                if (shouldFetchStats) {
                    requests.push(fetch('/api/get-stats'));
                }

                // 并行获取数据
                const responses = await Promise.all(requests);
                const [presetsRes, statsRes] = responses;

                if (presetsRes.ok) {
                    const presetsData: Preset[] = await presetsRes.json();
                    // 分类预设
                    setMagicalGirlPresets(presetsData.filter(p => p.type === 'magical-girl'));
                    setCanshouPresets(presetsData.filter(p => p.type === 'canshou'));

                    const infoMap = new Map<string, string>();
                    presetsData.forEach((p) => {
                        infoMap.set(p.name, p.description);
                    });
                    setPresetInfo(infoMap);
                } else {
                    console.error("获取预设失败");
                }

                // 只有在启用统计数据功能时才处理统计数据响应
                if (shouldFetchStats && statsRes) {
                    if (statsRes.ok) {
                        setStats(await statsRes.json());
                    } else {
                        console.error("获取统计数据失败:", statsRes.status, await statsRes.text());
                    }
                }
            } catch (err) {
                console.error('加载数据失败:', err);
                setError('无法加载预设列表或统计数据。');
            } finally {
                setIsLoadingPresets(false);
                setIsLoadingStats(false);
            }
        };
        fetchData();
    }, []);

    const getCombatantDisplayName = (data: any): string => {
        if (!data) return '未命名';
        return data.codename || data.name || data.title || '未命名';
    };

    const inferCombatantType = (data: any): CombatantType => {
        const template = inferTemplate(data);
        switch (template) {
            case 'magical-girl':
                return 'magical-girl';
            case 'canshou':
                return 'canshou';
            case 'general':
                return 'general-character';
            default:
                if (data?.codename) return 'magical-girl';
                if (data?.name) return 'canshou';
                return 'general-character';
        }
    };

    const readableCombatantCount = useMemo(() => (
        combatants.filter((c): c is CombatantData => 'data' in c).length
    ), [combatants]);

    const numericHistoryLimit = isArenaHistoryUnlimited
        ? Infinity
        : Math.max(1, Number(readArenaHistoryLimit) || 0);
    const estimatedHistoryTotal = readArenaHistory
        ? (numericHistoryLimit === Infinity ? Infinity : numericHistoryLimit * readableCombatantCount)
        : 0;
    const shouldWarnHistoryLimit = readArenaHistory && readableCombatantCount > 0 && (numericHistoryLimit === Infinity || estimatedHistoryTotal > 20);

    const validateGeneralCharacterData = (data: any, filename: string): { success: boolean } => {
        const parsed = GeneralCharacterSchema.safeParse(data);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const message = issue?.message ? `：${issue.message}` : '';
            setError(`❌ 通用角色文件 "${filename}" 格式不规范${message}。`);
            return { success: false };
        }
        return { success: true };
    };

    // 验证魔法少女数据
    const validateMagicalGirlData = (data: any, filename: string): { success: boolean, wasCorrected: boolean } => {
        // 兼容非规范但可用的文件
        if (data.name && data.construct) {
            data.codename = data.name; // 补充 codename 字段以供后续使用
            return { success: true, wasCorrected: false };
        }

        // 检查codename字段
        if (typeof data.codename !== 'string' || !data.codename) {
            setError(`❌ 文件 "${filename}" 格式不规范，缺少必需的 "codename" 字段。`);
            return { success: false, wasCorrected: false };
        }
        let warningMessage = '';
        let wasCorrected = false;
        // 遍历所有核心字段进行检查和修复
        for (const parentKey of Object.keys(MAGICAL_GIRL_CORE_FIELDS)) {
            if (data[parentKey] === undefined) {
                const childKeys = MAGICAL_GIRL_CORE_FIELDS[parentKey as keyof typeof MAGICAL_GIRL_CORE_FIELDS];
                const allChildrenExist = childKeys.every(childKey => data[childKey] !== undefined);

                // 如果所有子级项目都存在于顶层
                if (allChildrenExist) {
                    // 记录一个警告，告知用户格式问题
                    wasCorrected = true;
                    warningMessage += `检测到缺失的顶层项目 "${parentKey}"，但其子项目齐全，已自动兼容。\n`;
                    // 创建父级项目并将子级项目移动进去
                    data[parentKey] = {};
                    childKeys.forEach(childKey => {
                        data[parentKey][childKey] = data[childKey];
                        delete data[childKey]; // 从顶层删除已移动的子项目
                    });
                } else {
                    // 如果父级和子级都不完整，则这是一个真正的错误
                    setError(`❌ 文件 "${filename}" 格式不规范，缺少必需的 "${parentKey}" 字段或其部分子字段。`);
                    return { success: false, wasCorrected: false };
                }
            }
        }

        // 如果有任何警告信息，则显示出来（不会中断流程）
        if (warningMessage) {
            setError(`✔️ 文件 "${filename}" 已加载，但格式稍有不规范:\n${warningMessage.trim()}`);
        }
        return { success: true, wasCorrected };
    };

    // 验证残兽数据
    const validateCanshouData = (data: any, filename: string): { success: boolean } => {
        const missingField = CANSHOU_CORE_FIELDS.find(field => data[field] === undefined);
        if (missingField) {
            setError(`❌ 残兽文件 "${filename}" 格式不规范，缺少必需的 "${missingField}" 字段。`);
            return { success: false };
        }
        return { success: true };
    };

    // 统一处理添加参战者
    const addCombatant = (combatant: CombatantData) => { // 注意：这里只接收 CombatantData
        if (combatants.length >= MAX_COMBATANTS) {
            setError(`最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
            return;
        }
        setCombatants(prev => [...prev, combatant]);
        setError(null);
    };

    // 处理选择预设
    const handleRemoveCombatant = (key: string) => { // key 现在可以是 filename 或 id
        setCombatants(prev => prev.filter(c => ('id' in c ? c.id : c.filename) !== key));
    };

    const handleSelectPreset = async (preset: Preset) => {
        // 修改：在操作开始时就锁定按钮，防止重复点击
        setLoadingPreset(preset.filename);

        try {
            if (combatants.some(c => c.filename === preset.filename)) {
                handleRemoveCombatant(preset.filename);
                setError(null);
                return;
            }

            const response = await fetch(`/presets/${preset.filename}`);
            if (!response.ok) throw new Error(`无法加载 ${preset.name} 的设定文件。`);
            const presetData = await response.json();

            let validationResult;
            if (preset.type === 'magical-girl') {
                validationResult = validateMagicalGirlData(presetData, preset.name);
            } else {
                validationResult = { success: validateCanshouData(presetData, preset.name).success, wasCorrected: false };
            }

            if (!validationResult.success) return;

            presetData.isPreset = true;
            // 预设文件默认视为原生
            addCombatant({
                type: preset.type,
                data: presetData,
                filename: preset.filename,
                isValid: true, // 预设始终是原生的
                isPreset: true // 在 Combatant 对象层面标记为预设
            });

        } catch (err) {
            if (err instanceof Error) setError(err.message);
        } finally {
            // 操作结束后解除按钮锁定
            setLoadingPreset(null);
        }
    };

    // 统一处理文件上传和粘贴
    const processJsonData = async (jsonText: string, sourceName: string) => {
        let parsedData;
        try {
            parsedData = JSON.parse(jsonText);
        } catch {
            const sanitizedText = `[${jsonText.trim().replace(/}\s*{/g, '},{')}]`;
            parsedData = JSON.parse(sanitizedText);
        }

        const dataArray = Array.isArray(parsedData) ? parsedData : [parsedData];

        if (dataArray.length > (MAX_COMBATANTS - combatants.length)) {
            throw new Error(`队伍将超出${MAX_COMBATANTS}人上限！`);
        }

        const loadedCombatants: CombatantData[] = [];
        const warningState = { warned: false };

        for (const item of dataArray) {
            const template = inferTemplate(item);
            const itemName = getCombatantDisplayName(item) || sourceName;
            try {
                if (template === 'scenario') {
                    throw new Error('检测到情景文件，请在情景模式中使用。');
                }

                const type: CombatantType = template === 'magical-girl'
                    ? 'magical-girl'
                    : template === 'canshou'
                        ? 'canshou'
                        : template === 'general'
                            ? 'general-character'
                            : inferCombatantType(item);

                let validationOk = false;
                if (type === 'magical-girl') {
                    validationOk = validateMagicalGirlData(item, itemName).success;
                } else if (type === 'canshou') {
                    validationOk = validateCanshouData(item, itemName).success;
                } else {
                    validationOk = validateGeneralCharacterData(item, itemName).success;
                }

                if (!validationOk) {
                    throw new Error('标准验证失败');
                }

                const verificationResponse = await fetch('/api/verify-origin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
                const { isValid } = await verificationResponse.json();

                appendAdjudicationEventsFromSource(item.adjudicationEvents, itemName, {
                    warningState,
                    onLegacyDiscard: () => {
                        delete (item as Record<string, unknown>).adjudicationEvents;
                    }
                });

                loadedCombatants.push({ type, data: item, filename: itemName, isValid, isPreset: false, isNonStandard: false });

            } catch (e) {
                if (item && (item.codename || item.name || item.content)) {
                    setError(`✔️ 文件 "${itemName}" 格式不完全规范，已通过兼容模式加载。`);
                    const fallbackType = template === 'scenario' ? 'general-character' : inferCombatantType(item);
                    loadedCombatants.push({ type: fallbackType, data: item, filename: itemName, isValid: false, isPreset: false, isNonStandard: true });
                } else {
                    const errorMessage = e instanceof Error ? e.message : '未知错误';
                    throw new Error(`文件 "${itemName}" 格式不规范或处理失败: ${errorMessage}`);
                }
            }
        }
        setCombatants(prev => [...prev, ...loadedCombatants]);
    };


    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        try {
            const filePromises = Array.from(files).map(file => {
                if (file.type !== 'application/json') {
                    throw new Error(`文件 "${file.name}" 不是有效的 JSON 文件。`);
                }
                return file.text();
            });
            const fileContents = await Promise.all(filePromises);
            // 合并所有文件内容为一个字符串进行处理
            await processJsonData(fileContents.join('\n'), '上传的文件');
        } catch (err) {
            if (err instanceof Error) {
                setError(`❌ 文件处理失败: ${err.message}\n建议前往 https://www.toolhelper.cn/JSON/JSONFormat 进行格式化检查。`);
            }
        } finally {
            if (event.target) event.target.value = '';
        }
    };

    const handleAddFromPaste = async () => {
        const text = pastedJson.trim();
        if (!text) return;
        try {
            await processJsonData(text, '粘贴的内容');
            setPastedJson(''); // 成功后清空文本域
        } catch (err) {
            if (err instanceof Error) {
                setError(`❌ 文本解析失败: ${err.message}\n建议前往 https://www.toolhelper.cn/JSON/JSONFormat 进行格式化检查。`);
            }
        }
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

    // 处理数据卡选择
    const handleSelectDataCard = async (cardData: any) => {
        try {
            // 保存原始的私有键用于逻辑判断
            const originalCardName = cardData._cardName;

            // 删除以 _ 开头的键
            const cleanedCardData = removePrivateKeys(cardData);

            // 构造文件名显示
            const resolvedName = getCombatantDisplayName(cleanedCardData);
            const filename = `${originalCardName || resolvedName}.json`;

            const inferredTemplate = inferTemplate(cleanedCardData);

            // 根据数据类型判断是角色还是情景
            if (inferredTemplate === 'scenario') {
                // 这是情景数据卡，在情景模式下处理
                if (battleMode !== 'scenario') {
                    setError('❌ 情景数据卡只能在情景模式下使用。');
                    return;
                }
                // --- 新增：验证情景文件的原生性 ---
                const verificationResponse = await fetch('/api/verify-origin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(cleanedCardData),
                });
                const { isValid } = await verificationResponse.json();
                // 设置为情景内容
                setScenarioContent(cleanedCardData);
                setScenarioFileName(filename);
                setIsScenarioNative(isValid || false);
                appendAdjudicationEventsFromSource(cleanedCardData.adjudicationEvents, filename, {
                    onLegacyDiscard: () => {
                        delete (cleanedCardData as Record<string, unknown>).adjudicationEvents;
                    }
                });
                setError(null);
                return;
            }

            // 这是角色数据卡，检查角色数量限制
            if (combatants.length >= MAX_COMBATANTS) {
                setError(`❌ 最多只能添加${MAX_COMBATANTS}位角色。`);
                return;
            }

            // 检查是否已存在同名文件
            if (combatants.some(c => c.filename === filename)) {
                setError(`❌ 已添加同名角色: ${filename}`);
                return;
            }

            // 这是角色数据卡
            const type = inferredTemplate === 'magical-girl'
                ? 'magical-girl'
                : inferredTemplate === 'canshou'
                    ? 'canshou'
                    : 'general-character';

            if (type === 'magical-girl') {
                if (!validateMagicalGirlData(cleanedCardData, filename).success) return;
            } else if (type === 'canshou') {
                if (!validateCanshouData(cleanedCardData, filename).success) return;
            } else {
                if (!validateGeneralCharacterData(cleanedCardData, filename).success) return;
            }
            const verificationResponse = await fetch('/api/verify-origin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanedCardData),
            });
            const { isValid } = await verificationResponse.json();
            const combatant: CombatantData = {
                type,
                data: cleanedCardData,
                filename,
                isValid: isValid || false,
                isPreset: false,
                isNonStandard: false
            };


            setCombatants(prev => [...prev, combatant]);
            setError(null);

        } catch (err) {
            setError(`❌ 数据卡加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
    };

    /**
     * @description 处理随机匹配角色或情景的逻辑。
     * @param type - 'character' 或 'scenario'
     */
    const handleRandomMatch = async (type: 'character' | 'scenario') => {
        // 检查角色数量上限
        if (type === 'character' && combatants.length >= MAX_COMBATANTS) {
            setError(`最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
            return;
        }

        // 设置加载状态，并向用户显示提示信息
        setIsMatching(type);
        setError(`正在从数据库中随机寻找一位公开的${type === 'character' ? '角色' : '情景'}...`);

        try {
            const response = await fetch(`/api/random-public-card?type=${type}`);
            const result = await response.json();

            // 处理API返回的错误
            if (!response.ok || !result.success) {
                throw new Error(result.error || '无法获取随机数据');
            }
            
            // API返回的数据在 result.card 中
            const card = result.card;
            // 卡片的核心数据是存储为JSON字符串的，需要解析
            const cardData = JSON.parse(card.data);
            
            // 将获取到的数据传递给通用的选择处理器
            await handleSelectDataCard({
                ...cardData,
                _cardId: card.id,
                _cardName: card.name,
                _isPublic: card.is_public,
                _author: card.username || '未知'
            });

        } catch (err) {
            setError(`❌ 随机匹配失败: ${err instanceof Error ? err.message : '未知错误'}`);
        } finally {
            // 清除加载状态
            setIsMatching(null);
        }
    };

    // 打开角色数据卡选择器
    const handleOpenCharacterDataModal = () => {
        setDataModalType('character');
        setShowBattleDataModal(true);
    };

    // 打开情景数据卡选择器
    const handleOpenScenarioDataModal = () => {
        setDataModalType('scenario');
        setShowBattleDataModal(true);
    };

    const handlePasteAndLoadScenario = async () => {
        const text = pastedScenarioJson.trim();
        if (!text) return;
        try {
            const json = JSON.parse(text);
            if (!json.title || !json.elements) {
                throw new Error('情景文件缺少必需的 title 或 elements 字段。');
            }

            // --- 新增：验证情景文件的原生性 ---
            const verificationResponse = await fetch('/api/verify-origin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(json),
            });
            const { isValid } = await verificationResponse.json();
            setIsScenarioNative(isValid);

            setScenarioContent(json);
            setScenarioFileName(json.title || '粘贴的情景');
            appendAdjudicationEventsFromSource(json.adjudicationEvents, json.title || '粘贴的情景', {
                onLegacyDiscard: () => {
                    delete (json as Record<string, unknown>).adjudicationEvents;
                }
            });
            setError(null);
            setPastedScenarioJson('');
        } catch (err) {
            const message = err instanceof Error ? err.message : '无法解析文本。';
            setError(`❌ 情景解析失败: ${message}`);
            setScenarioContent(null);
            setScenarioFileName(null);
            setIsScenarioNative(false); // 出错时重置
        }
    };


    const handleClearRoster = () => {
        setCombatants([]);
        setNewsReport(null);
        setError(null);
        setCorrectedFiles({});
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDownloadCorrectedJson = (identifier: string) => {
        const combatant = combatants.find(c => !('id' in c) && (c as CombatantData).filename === identifier) as CombatantData | undefined;
        if (!combatant) return;
        const jsonData = JSON.stringify(combatant.data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const baseName = getCombatantDisplayName(combatant.data);
        link.download = `${baseName}_修正版.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleCopyCorrectedJson = (identifier: string) => {
        const combatant = combatants.find(c => !('id' in c) && (c as CombatantData).filename === identifier) as CombatantData | undefined;
        if (!combatant) return;
        const jsonData = JSON.stringify(combatant.data, null, 2);
        navigator.clipboard.writeText(jsonData).then(() => {
            setCopiedStatus(prev => ({ ...prev, [identifier]: true }));
            setTimeout(() => {
                setCopiedStatus(prev => ({ ...prev, [identifier]: false }));
            }, 2000); // 2秒后恢复按钮状态
        });
    };

    const handleTeamChange = (filename: string, teamId: number) => {
        setCombatants(prev =>
            prev.map(c =>
                c.filename === filename ? { ...c, teamId: teamId === 0 ? undefined : teamId } : c
            )
        );
    };

    const handleScenarioFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            setScenarioContent(null);
            setScenarioFileName(null);
            setIsScenarioNative(false); // 重置状态
            return;
        }
        if (file.type !== 'application/json') {
            setError('❌ 情景文件必须是 .json 格式。');
            return;
        }
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            // 简单验证一下情景文件结构
            if (!json.title || !json.elements) {
                throw new Error('情景文件缺少必需的 title 或 elements 字段。');
            }

            // --- 验证情景文件的原生性 ---
            const verificationResponse = await fetch('/api/verify-origin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(json),
            });
            const { isValid } = await verificationResponse.json();
            setIsScenarioNative(isValid);

            setScenarioContent(json);
            setScenarioFileName(file.name);
            appendAdjudicationEventsFromSource(json.adjudicationEvents, file.name, {
                onLegacyDiscard: () => {
                    delete (json as Record<string, unknown>).adjudicationEvents;
                }
            });
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : '无法解析文件。';
            setError(`❌ 情景文件读取失败: ${message}`);
            setScenarioContent(null);
            setScenarioFileName(null);
            setIsScenarioNative(false); // 出错时重置
        } finally {
            if (event.target) event.target.value = ''; // 允许重复上传同一个文件
        }
    };

    const downloadUpdatedJson = (characterData: any) => {
        const name = getCombatantDisplayName(characterData);
        const jsonData = JSON.stringify(characterData, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `角色设定_${name}_更新.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const redirectToArrested = (reason?: string, withBackup?: boolean) => {
        const query: Record<string, string> = {};
        if (reason) query.reason = reason;
        if (withBackup) query.backup = '1';
        if (Object.keys(query).length > 0) {
            router.push({ pathname: '/arrested', query });
        } else {
            router.push('/arrested');
        }
    };

    const buildStreamingBackupItems = (options?: { adjudicationResults?: AdjudicationResult[] | null }): ArrestedBackupDraftItem[] => {
        const items: ArrestedBackupDraftItem[] = [];
        const playableCombatants = combatants.filter((c): c is CombatantData => 'data' in c);

        playableCombatants.forEach((combatant, index) => {
            items.push({
                id: `combatant-${index}`,
                label: `参战者：${getCombatantDisplayName(combatant.data)}`,
                filename: combatant.filename || getCombatantDisplayName(combatant.data) || `combatant-${index + 1}.json`,
                content: combatant.data,
                description: combatant.isPreset ? '预设角色' : '用户上传角色',
            });
        });

        if (scenarioContent) {
            items.push({
                id: 'scenario',
                label: scenarioDisplayName ? `情景：${scenarioDisplayName}` : '情景设定',
                filename: scenarioFileName || (scenarioDisplayName ? `${scenarioDisplayName}.json` : 'scenario.json'),
                content: scenarioContent,
                description: isScenarioNative ? '原生情景文件' : '用户自定义情景',
            });
        }

        if (userGuidance.trim()) {
            items.push({
                id: 'user-guidance',
                label: '故事引导文本',
                filename: 'user-guidance.txt',
                mimeType: 'text/plain',
                content: userGuidance.trim(),
            });
        }

        if (adjudicationEvents.length > 0) {
            items.push({
                id: 'adjudication-events',
                label: '随机判定器配置',
                filename: 'adjudication-events.json',
                content: adjudicationEvents,
                description: '用户设置的随机事件链',
            });
        }

        if (options?.adjudicationResults?.length) {
            items.push({
                id: 'adjudication-results',
                label: '随机判定结果',
                filename: 'adjudication-results.json',
                content: options.adjudicationResults,
                description: '本次生成返回的判定结果',
            });
        }

        return items;
    };

    type SensitiveCheckOptions = {
        source?: ArrestedBackupTriggerSource;
        reason?: string;
        origin?: string;
        backupItems?: ArrestedBackupDraftItem[];
    };

    const checkSensitiveWords = async (content: string, options?: SensitiveCheckOptions) => {
        const checkResult = await quickCheck(content);
        if (checkResult.hasSensitiveWords) {
            if (options?.source === 'output') {
                const backupItems = options.backupItems ?? [];
                if (backupItems.length > 0) {
                    persistArrestedBackup({
                        triggerSource: 'output',
                        origin: options.origin || 'battle-stream',
                        reason: options.reason,
                        items: backupItems,
                    });
                }
                redirectToArrested(options?.reason, backupItems.length > 0);
            } else {
                redirectToArrested(options?.reason);
            }
            return true;
        }
        return false;
    }

    // 处理生成按钮点击事件
    const handleGenerate = async () => {
        if (isCooldown) {
            setError(`冷却中，请等待 ${remainingTime} 秒后再生成。`);
            return;
        }

        const minParticipants = (battleMode === 'daily' || battleMode === 'scenario') ? 1 : 2;
        const maxParticipants = MAX_COMBATANTS;
        if (combatants.length < minParticipants || combatants.length > MAX_COMBATANTS) {
            setError(`⚠️ 该模式需要 ${minParticipants} 到 ${maxParticipants} 位角色。`);
            return;
        }

        if (battleMode === 'scenario' && !scenarioContent) {
            setError('⚠️ 情景模式下，请先上传一个情景文件。');
            return;
        }

        if (userProviderConfig && !userProviderConfig.apiKey) {
            setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
            return;
        }

        setIsGenerating(true);
        setError(null);
        setNewsReport(null);
        setUpdatedCombatants([]); // 清空上次的结果
        setAdjudicationResults(null); // 清空上次的判定结果

        try {
            // --- 处理随机角色占位符 ---
            let finalCombatants: Combatant[] = [...combatants];
            const placeholders = combatants.filter((c): c is RandomCombatantPlaceholder => 'id' in c);

            if (placeholders.length > 0) {
                setError('正在生成随机角色...'); // 提示用户
                // 同步调用客户端生成函数
                const generatedCharacters = placeholders.map(p => {
                    if (p.type === 'random-magical-girl') {
                        return generateRandomMagicalGirl();
                    }
                    return generateRandomCanshou();
                });

                // 将生成的角色数据转换为 CombatantData 格式
                const newCombatants: CombatantData[] = generatedCharacters.map((data, i) => {
                    const type = inferCombatantType(data);
                    return {
                        type,
                        data,
                        filename: `${placeholders[i].filename} - ${getCombatantDisplayName(data)}`,
                        isValid: true, // 随机生成的角色视为原生
                        isPreset: false,
                        isNonStandard: false,
                    };
                });

                // 替换掉占位符
                const existingCombatants = combatants.filter(c => !('id' in c));
                finalCombatants = [...existingCombatants, ...newCombatants];
                setCombatants(finalCombatants); // 更新UI以显示新生成的角色
            }

            // 安全检查（使用处理后的 finalCombatants）
            const combatantsForCheck = (finalCombatants.filter(c => 'data' in c) as CombatantData[]).map(c => c.data);
            if (await checkSensitiveWords(JSON.stringify(combatantsForCheck))) return;
            if (userGuidance && (await checkSensitiveWords(userGuidance))) return;
            if (scenarioContent && (await checkSensitiveWords(JSON.stringify(scenarioContent)))) return;

            // 构造分队信息
            const teams: { [key: number]: string[] } = {};
            finalCombatants.forEach(c => {
                if ('data' in c && c.teamId) { // 确保是 CombatantData
                    if (!teams[c.teamId]) {
                        teams[c.teamId] = [];
                    }
                    teams[c.teamId].push(getCombatantDisplayName(c.data));
                }
            });

            const arenaHistoryReadLimit = readArenaHistory
                ? (isArenaHistoryUnlimited ? null : Math.max(1, Number(readArenaHistoryLimit) || 0))
                : undefined;

            const requestBody: Record<string, unknown> = {
                combatants: (finalCombatants.filter(c => 'data' in c) as CombatantData[]).map(c => ({
                    type: c.type,
                    data: c.data,
                    isNative: c.isValid,
                    isPreset: c.isPreset
                })),
                selectedLevel,
                mode: battleMode,
                userGuidance: userGuidance,
                scenario: scenarioContent,
                teams: Object.keys(teams).length > 0 ? teams : undefined,
                language: selectedLanguage,
                readArenaHistory,
                arenaHistoryReadLimit,
                writeArenaHistory,
                readCurrentState,
                writeCurrentState,
                isDowngrade: isDowngrade,
                adjudicationEvents: adjudicationEvents,
                storyLength: storyLength,
            };

            if (userProviderConfig && userProviderConfig.apiKey) {
                requestBody.customProvider = {
                    providerId: userProviderConfig.providerId,
                    modelId: userProviderConfig.modelId,
                    apiKey: userProviderConfig.apiKey,
                };
            }

            const response = await fetch('/api/stream/generate-battle-story', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            // --- 核心修改：增强错误处理 ---
            if (!response.ok) {
                // 首先，尝试将响应体作为文本读取
                const errorText = await response.text();
                let errorMessage = `服务器返回了错误 (状态码: ${response.status})。`;

                try {
                    // 尝试将文本解析为JSON
                    const errorJson = JSON.parse(errorText);
                    // 如果成功，并且是需要跳转的特定错误，则执行跳转
                    if (errorJson.shouldRedirect) {
                        router.push({
                            pathname: '/arrested',
                            query: { reason: errorJson.reason || '使用危险符文' }
                        });
                        return; // 终止后续执行
                    }
                    // 否则，使用JSON中的详细错误信息
                    errorMessage = errorJson.message || errorJson.error || errorMessage;
                } catch {
                    // 如果解析失败，说明响应不是JSON格式（可能是HTML错误页）
                    // 此时，我们可以显示一个更通用的消息，或者在开发模式下显示原始文本
                    console.error("收到了非JSON格式的错误响应:", errorText);
                    errorMessage = '服务器响应异常，可能是服务暂时不可用，请稍后再试。';
                }
                throw new Error(errorMessage);
            }

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('text/event-stream')) {
                const unexpectedBody = await response.text();
                console.error('意外的响应内容:', unexpectedBody);
                throw new Error('服务器未返回流式数据，暂时无法生成战报。');
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('当前浏览器不支持流式输出，请使用最新版本的现代浏览器。');
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let finalPayload: BattleApiResponse | null = null;
            let shouldAbort = false;

            setLiveArticleBody('');
            setIsStreaming(true);
            setNewsReport({
                headline: '故事生成中...',
                reporterInfo: {
                    name: '直播记者·星尘',
                    publication: '魔法少女通讯社',
                },
                article: {
                    body: '',
                    analysis: '记者正在实时整理点评，请稍候。',
                },
                officialReport: {
                    winner: '待定',
                    conclusion: '故事仍在进行，最终结论稍后揭晓。',
                },
                userGuidance: userGuidance || undefined,
                mode: battleMode,
            });

            const processEvent = async (evt: SSEEventPayload) => {
                if (evt.event === 'status' || evt.event === 'yaml') {
                    return;
                }

                if (evt.event === 'article_body') {
                    const payload = safeJsonParse<{ text: string }>(evt.data);
                    if (payload && typeof payload.text === 'string') {
                        setLiveArticleBody(payload.text);
                    }
                    return;
                }

                if (evt.event === 'error') {
                    const payload = safeJsonParse<{ message?: string }>(evt.data);
                    throw new Error(payload?.message || '生成失败');
                }

                if (evt.event === 'final') {
                    const payload = safeJsonParse<BattleApiResponse>(evt.data);
                    if (!payload) {
                        throw new Error('无法解析最终战报数据');
                    }

                    if (await checkSensitiveWords(JSON.stringify(payload.report), {
                        source: 'output',
                        origin: 'battle-stream',
                        reason: '使用危险符文',
                        backupItems: buildStreamingBackupItems({ adjudicationResults: payload.adjudicationResults }),
                    })) {
                        shouldAbort = true;
                        return;
                    }

                    finalPayload = payload;

                    const reportWithAdjudication: NewsReport = {
                        ...payload.report,
                        adjudicationResults: payload.adjudicationResults,
                    };

                    if (scenarioDisplayName) {
                        reportWithAdjudication.scenario = scenarioDisplayName;
                    }

                    setNewsReport(reportWithAdjudication);
                    setUpdatedCombatants(payload.updatedCombatants);
                    if (payload.adjudicationResults) {
                        setAdjudicationResults(payload.adjudicationResults);
                    }

                    setCombatants(prev =>
                        (prev.filter(c => 'data' in c) as CombatantData[]).map(oldCombatant => {
                            const updatedData = payload.updatedCombatants.find(
                                uc => getCombatantDisplayName(uc) === getCombatantDisplayName(oldCombatant.data)
                            );
                            return updatedData ? { ...oldCombatant, data: updatedData } : oldCombatant;
                        })
                    );

                    setLiveArticleBody(null);
                }
            };

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                if (!value) {
                    continue;
                }

                buffer += decoder.decode(value, { stream: true });

                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
                    const rawEvent = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const parsedEvent = parseSSEEvent(rawEvent);
                    if (parsedEvent) {
                        await processEvent(parsedEvent);
                        if (shouldAbort) {
                            await reader.cancel().catch(() => undefined);
                            break;
                        }
                    }
                    boundary = buffer.indexOf('\n\n');
                }

                if (shouldAbort) {
                    break;
                }
            }

            if (shouldAbort) {
                setNewsReport(null);
                setLiveArticleBody(null);
                return;
            }

            if (!finalPayload) {
                throw new Error('未收到完整的战报数据。');
            }

            startCooldown();
        } catch (err) {
            // 现在的 catch 块可以捕获到更明确的错误信息
            if (err instanceof Error) {
                setError(`✨ 魔法失效了！${err.message}`);
            } else {
                setError('✨ 魔法失效了！生成故事时发生未知错误，请重试。');
            }
            setNewsReport(null);
            setLiveArticleBody(null);
        } finally {
            setIsGenerating(false);
            setIsStreaming(false);
        }
    };

    // 为情景模式添加按钮文本
    const getButtonText = () => {
        if (isCooldown) return `记者赶稿中...请等待 ${remainingTime} 秒`;
        if (isGenerating) {
            switch (battleMode) {
                case 'daily': return '撰写日常逸闻中... (｡･ω･｡)ﾉ';
                case 'kizuna': return '描绘宿命对决中... (ง •̀_•́)ง';
                case 'classic': return '推演激烈战斗中... (ง •̀_•́)ง';
                case 'scenario': return '演绎指定剧本中... (｡･ω･｡)ﾉ';
            }
        }
        switch (battleMode) {
            case 'daily': return '生成日常故事 (´｡• ᵕ •｡`) ♡';
            case 'kizuna': return '生成宿命对决 (๑•̀ㅂ•́)و✧';
            case 'classic': return '生成独家新闻 _φ(❐_❐✧';
            case 'scenario': return '开始演绎情景 (´｡• ᵕ •｡`)';
        }
    };

    // 处理图片保存回调
    const handleSaveImage = (imageUrl: string) => {
        setSavedImageUrl(imageUrl);
        setShowImageModal(true);
    };

    // 渲染预设列表的通用函数
    const renderPresetSelector = (presets: Preset[], currentPage: number, setCurrentPage: (page: number) => void, title: string) => (
        <div className="mb-6">
            <h3 className="input-label" style={{ marginTop: '0.5rem' }}>{title}</h3>
            {isLoadingPresets ? (
                <p className="text-sm text-gray-500">正在加载预设...</p>
            ) : (
                <div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {presets.slice((currentPage - 1) * presetsPerPage, currentPage * presetsPerPage).map(preset => {
                            const isSelected = combatants.some(c => c.filename === preset.filename);
                            // 修改：增加 loadingPreset 和 isGenerating 的判断
                            const isLoadingThis = loadingPreset === preset.filename;
                            const isDisabled = isGenerating || isLoadingThis || (!isSelected && combatants.length >= MAX_COMBATANTS);

                            const bgColor = preset.type === 'canshou'
                                ? (isSelected ? 'bg-red-200 border-red-400 hover:bg-red-300' : 'bg-white border-gray-300 hover:border-red-400 hover:bg-red-50')
                                : (isSelected ? 'bg-pink-200 border-pink-400 hover:bg-pink-300' : 'bg-white border-gray-300 hover:border-pink-400 hover:bg-pink-50');
                            const textColor = preset.type === 'canshou'
                                ? (isSelected ? 'text-red-900' : 'text-red-800')
                                : (isSelected ? 'text-pink-900' : 'text-pink-800');

                            return (
                                <div
                                    key={preset.filename}
                                    onClick={() => !isDisabled && handleSelectPreset(preset)}
                                    className={`p-3 border rounded-lg transition-all duration-200 ${isDisabled ? 'bg-gray-200 border-gray-300 text-gray-500 cursor-not-allowed' : `${bgColor} cursor-pointer`}`}
                                >
                                    {/* 修改：根据加载状态显示不同文本 */}
                                    <p className={`font-semibold ${textColor}`}>{isLoadingThis ? '加载中...' : preset.name}</p>
                                    <p className={`text-xs mt-1 ${isSelected ? (preset.type === 'canshou' ? 'text-red-800' : 'text-pink-800') : 'text-gray-600'}`}>{preset.description}</p>
                                </div>
                            );
                        })}
                    </div>
                    {presets.length > presetsPerPage && (
                        <div className="flex justify-center items-center mt-4 space-x-2">
                            <button onClick={() => setCurrentPage(Math.max(currentPage - 1, 1))} disabled={isGenerating || currentPage === 1} className={`px-3 py-1 rounded text-sm ${currentPage === 1 || isGenerating ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'}`}>上一页</button>
                            <span className="text-sm text-gray-600">第 {currentPage} / {Math.ceil(presets.length / presetsPerPage)} 页</span>
                            <button onClick={() => setCurrentPage(Math.min(currentPage + 1, Math.ceil(presets.length / presetsPerPage)))} disabled={isGenerating || currentPage === Math.ceil(presets.length / presetsPerPage)} className={`px-3 py-1 rounded text-sm ${currentPage === Math.ceil(presets.length / presetsPerPage) || isGenerating ? 'bg-gray-200 text-gray-400' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'}`}>下一页</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <>
            <Head>
                <title>魔法少女竞技场 - MahoShojo Generator</title>
                <meta name="description" content="上传魔法少女或残兽设定，生成她们之间的战斗或日常故事！" />
            </Head>
            <div className="magic-background-white">
                <div className="container">
                    <div className="card" style={{ border: "2px solid #ccc", background: "#f9f9f9" }}>
                        <div className="text-center mb-4">
                            <img src="/arena-black.svg" width={320} height={90} alt="魔法少女竞技场" />
                            <p className="subtitle" style={{ marginBottom: '1rem', marginTop: '1rem' }}>能亲眼见到强者之战，这下就算死也会值回票价呀！</p>
                        </div>

                        <div className="mb-6 p-4 bg-gray-200 border border-gray-300 rounded-lg text-sm text-gray-800" style={{ padding: '1rem' }}>
                            <h3 className="font-bold mb-2">📰 使用须知</h3>
                            <ol className="list-decimal list-inside space-y-1">
                                <li>前往<Link href="/details" className="footer-link">【奇妙妖精大调查】</Link>或<Link href="/canshou" className="footer-link">【研究院残兽调查】</Link>页面，生成角色并下载其【设定文件】。</li>
                                <li>收集 2-10 位角色的设定文件（.json 格式）。</li>
                                <li>在此处选择预设角色、上传设定文件，也可以加入随机生成角色或使用【随机匹配】功能从数据库中抽取其他用户分享的角色</li>
                                <li>选择一个模式，然后敬请期待在「命运的舞台」之上发生的故事吧！</li>
                            </ol>
                        </div>

                        {renderPresetSelector(magicalGirlPresets, currentMgPresetPage, setCurrentMgPresetPage, '选择预设魔法少女')}
                        {renderPresetSelector(canshouPresets, currentCanshouPresetPage, setCurrentCanshouPresetPage, '选择预设残兽')}

                        {/* 数据库数据选择按钮 */}
                        <div className="mb-6">
                            <h3 className="input-label">从数据库选择角色</h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleOpenCharacterDataModal}
                                    disabled={isGenerating || combatants.length >= MAX_COMBATANTS}
                                    className="flex-1 px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    浏览在线角色库
                                </button>
                                <button
                                    onClick={() => handleRandomMatch('character')}
                                    disabled={isGenerating || isMatching !== null || combatants.length >= MAX_COMBATANTS}
                                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {isMatching === 'character' ? '匹配中...' : '随机匹配角色'}
                                </button>
                            </div>
                            {!isAuthenticated && (
                                <div className="text-xs text-gray-500 flex items-center px-2 mt-2">
                                    <Link
                                        href="/character-manager"
                                        className="text-pink-600 hover:text-pink-800 underline"
                                    >
                                        登录后可访问私有数据卡
                                    </Link>
                                </div>
                            )}
                        </div>

                        <div className="input-group">
                            <label htmlFor="file-upload" className="input-label">上传自己的 .json 设定文件</label>
                            <input ref={fileInputRef} id="file-upload" type="file" multiple accept=".json" onChange={handleFileChange} disabled={isGenerating} className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed" />
                        </div>

                        <div className="mb-6">
                            <button onClick={() => setIsPasteAreaVisible(!isPasteAreaVisible)} className="text-pink-700 hover:underline cursor-pointer mb-2 font-semibold">
                                {isPasteAreaVisible ? '▼ 折叠角色粘贴区域' : '▶ 展开角色粘贴区域 (手机端推荐)'}
                            </button>
                            {isPasteAreaVisible && (
                                <div className="input-group mt-2">
                                    <textarea value={pastedJson} onChange={(e) => setPastedJson(e.target.value)} placeholder="在此处粘贴一个或多个魔法少女/残兽的设定文件(.json)内容..." className="input-field resize-y h-32" disabled={isGenerating} />
                                    <button onClick={handleAddFromPaste} disabled={!pastedJson.trim() || isGenerating || combatants.length >= MAX_COMBATANTS} className="generate-button mt-2 mb-0">从文本添加角色</button>
                                </div>
                            )}
                        </div>

                        {/* --- 已选角色列表 --- */}
                        {combatants.length > 0 && (
                            <div className="mb-4 p-3 bg-gray-200 rounded-lg">
                                <div className="flex justify-between items-center m-0 top-0 right-0">
                                    <p className="font-semibold text-sm text-gray-700">已选角色 ({combatants.length}/{MAX_COMBATANTS}):</p>
                                    <button onClick={handleClearRoster} disabled={isGenerating} className="text-sm text-red-500 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">清空列表</button>
                                </div>
                                <div className="flex gap-2 mt-3">
                                    <button
                                        onClick={() => {
                                            if (combatants.length >= MAX_COMBATANTS) {
                                                setError(`最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
                                                return;
                                            }
                                            const newPlaceholder: RandomCombatantPlaceholder = {
                                                type: 'random-magical-girl',
                                                id: `random-mg-${Date.now()}`,
                                                filename: '随机魔法少女',
                                            };
                                            setCombatants(prev => [...prev, newPlaceholder]);
                                        }}
                                        disabled={isGenerating || combatants.length >= MAX_COMBATANTS}
                                        className="text-xs flex-1 bg-pink-100 text-pink-700 px-3 py-1.5 rounded-lg hover:bg-pink-200 disabled:opacity-50"
                                    >
                                        + 添加随机魔法少女
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (combatants.length >= MAX_COMBATANTS) {
                                                setError(`最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
                                                return;
                                            }
                                            const newPlaceholder: RandomCombatantPlaceholder = {
                                                type: 'random-canshou',
                                                id: `random-cs-${Date.now()}`,
                                                filename: '随机残兽',
                                            };
                                            setCombatants(prev => [...prev, newPlaceholder]);
                                        }}
                                        disabled={isGenerating || combatants.length >= MAX_COMBATANTS}
                                        className="text-xs flex-1 bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50"
                                    >
                                        + 添加随机残兽
                                    </button>
                                </div>
                                <ul className="list-disc list-inside text-sm text-gray-600 mt-2 space-y-2">
                                    {combatants.map(c => {
                                        // 类型守卫，判断是真实角色数据还是占位符
                                        const isPlaceholder = 'id' in c;
                                        const key = isPlaceholder ? c.id : c.filename;
                                        const combatantData = isPlaceholder ? null : (c as CombatantData);
                                        const displayName = isPlaceholder ? c.filename : getCombatantDisplayName(combatantData?.data);
                                        const typeDisplay = isPlaceholder
                                            ? (c.type === 'random-magical-girl' ? '(随机魔法少女)' : '(随机残兽)')
                                            : `(${COMBATANT_TYPE_LABELS[combatantData!.type]})`;
                                        const fileKey = isPlaceholder ? c.filename : combatantData!.filename;
                                        const isCorrected = !isPlaceholder && correctedFiles[fileKey];

                                                return (
                                                    <li key={key} className="flex justify-between items-start group gap-2">
                                                        <div className="flex items-center flex-grow min-w-0">
                                                        <span className="break-words mr-2" title={displayName}>
                                                            {displayName}
                                                            <span className="text-xs text-gray-500 ml-1">{typeDisplay}</span>
                                                                {!isPlaceholder && c.isPreset && <span className="text-xs text-purple-600 ml-1">(预设)</span>}
                                                                {!isPlaceholder && c.isValid && <span className="text-xs text-green-600 ml-1">(原生)</span>}
                                                                {isCorrected && <span className="text-xs text-yellow-600 ml-2">(格式已修正)</span>}
                                                                {!isPlaceholder && c.isNonStandard && <span className="text-xs text-orange-500 ml-1 font-semibold">(非规范格式)</span>}
                                                            </span>
                                                            {/* 分队选择器 (占位符不可分队) */}
                                                            {!isPlaceholder && (
                                                                <select
                                                                    value={c.teamId || 0}
                                                                    onChange={(e) => handleTeamChange(c.filename, parseInt(e.target.value))}
                                                                    className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white disabled:opacity-50 ml-auto" // 使用 ml-auto 保持在右侧
                                                                    disabled={isGenerating}
                                                                >
                                                                    <option value={0}>无分队</option>
                                                                    <option value={1}>队伍 1</option>
                                                                    <option value={2}>队伍 2</option>
                                                                    <option value={3}>队伍 3</option>
                                                                    <option value={4}>队伍 4</option>
                                                                </select>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center flex-shrink-0">
                                                            {isCorrected && (
                                                                <div className="flex gap-2 mr-2">
                                                                    <button onClick={() => handleDownloadCorrectedJson(fileKey)} disabled={isGenerating} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">下载</button>
                                                                    <button onClick={() => handleCopyCorrectedJson(fileKey)} disabled={isGenerating} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 w-16">{copiedStatus[fileKey] ? '已复制!' : '复制'}</button>
                                                                </div>
                                                            )}
                                                            {/* 单个删除按钮 */}
                                                            <button
                                                                onClick={() => !isGenerating && handleRemoveCombatant(key)}
                                                                className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'}`}
                                                                aria-label={`移除 ${displayName}`}
                                                                disabled={isGenerating}
                                                            >
                                                                X
                                                            </button>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>

                                {/* --- 历战记录超限提示 --- */}
                                {combatants.some(c => 'data' in c && c.data.arena_history?.entries?.length > 20) && (
                                    <div className="mt-3 text-xs text-gray-500">
                                        <p>
                                            ⚠️ 注意：
                                            {combatants
                                                .filter((c): c is CombatantData => 'data' in c && !!c.data.arena_history?.entries)
                                                .filter(c => c.data.arena_history.entries.length > 20)
                                                .map(c => `“${getCombatantDisplayName(c.data)}”(${c.data.arena_history.entries.length}条) `)
                                                .join('、')
                                            }
                                            的历战记录已超过20条上限，生成故事时将仅选取最重要的部分。
                                            <Link href="/sublimation" className="text-blue-600 hover:underline font-semibold">
                                                考虑前往「成长升华」
                                            </Link>
                                            来凝练角色的成长。
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 战斗模式切换UI */}
                        <div className="input-group">
                            <label className="input-label">选择故事模式</label>
                            <div className="flex items-center space-x-1 bg-gray-200 p-1 rounded-full">
                                <button
                                    onClick={() => setBattleMode('daily')}
                                    disabled={isGenerating}
                                    className={`w-1/4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${battleMode === 'daily' ? 'bg-white text-green-600 shadow' : 'text-gray-600 hover:bg-gray-300'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    日常模式☕
                                </button>
                                <button
                                    onClick={() => setBattleMode('kizuna')}
                                    disabled={isGenerating}
                                    className={`w-1/4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${battleMode === 'kizuna' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:bg-gray-300'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    羁绊模式✨
                                </button>
                                <button
                                    onClick={() => setBattleMode('classic')}
                                    disabled={isGenerating}
                                    className={`w-1/4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${battleMode === 'classic' ? 'bg-white text-pink-600 shadow' : 'text-gray-600 hover:bg-gray-300'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    经典模式⚔️
                                </button>
                                <button
                                    onClick={() => setBattleMode('scenario')}
                                    disabled={isGenerating}
                                    className={`w-1/4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${battleMode === 'scenario' ? 'bg-white text-purple-600 shadow' : 'text-gray-600 hover:bg-gray-300'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    情景模式📜
                                </button>
                            </div>
                            {battleMode === 'daily' && (
                                <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                                    <p className="font-bold">你已选择【日常模式】！</p>
                                    <p className="mt-1">此模式下将聚焦于角色间的互动故事，而非战斗。</p>
                                </div>
                            )}
                            {battleMode === 'kizuna' && (
                                <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                                    <p className="font-bold">你已选择【羁绊模式】！</p>
                                    <p className="mt-1">在此模式下，战斗将更注重友情！热血！羁绊！角色的背景、信念与羁绊将成为关键，能力强度不再是决定胜负的核心因素。</p>
                                </div>
                            )}
                            {battleMode === 'classic' && (
                                <div className="mt-2 p-3 bg-pink-50 border border-pink-200 rounded-lg text-sm text-pink-800">
                                    <p className="font-bold">你已选择【经典模式】！</p>
                                    <p className="mt-1">经典模式：战斗结果主要基于角色的能力设定和战斗推演规则。</p>
                                </div>
                            )}
                        </div>

                        {/* --- 情景模式UI --- */}
                        {battleMode === 'scenario' && (
                            <div className="mt-4">
                                <div className="mb-4">
                                    <h3 className="input-label">选择情景</h3>
                                    <div className="flex gap-2 mb-4">
                                        <button
                                            onClick={handleOpenScenarioDataModal}
                                            disabled={isGenerating}
                                            className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                        >
                                            浏览在线情景库
                                        </button>
                                        <button
                                            onClick={() => handleRandomMatch('scenario')}
                                            disabled={isGenerating || isMatching !== null}
                                            className="flex-1 px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                        >
                                            {isMatching === 'scenario' ? '匹配中...' : '随机匹配情景'}
                                        </button>
                                    </div>
                                    {!isAuthenticated && (
                                        <div className="flex-1 text-xs text-gray-500 flex items-center px-2">
                                            <Link
                                                href="/character-manager"
                                                className="text-green-600 hover:text-green-800 underline"
                                            >
                                                登录后可访问私有数据卡
                                            </Link>
                                        </div>
                                    )}
                                </div>
                                <label htmlFor="scenario-upload" className="input-label">上传情景文件 (.json)</label>
                                <input
                                    id="scenario-upload"
                                    type="file"
                                    accept=".json"
                                    onChange={handleScenarioFileChange}
                                    disabled={isGenerating}
                                    className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                                {scenarioFileName && (
                                    <p className="text-xs text-gray-500 mt-2">
                                        已加载情景: <span className="font-bold text-green-600">{scenarioFileName}</span>
                                        {isScenarioNative && <span className="text-xs text-green-600 ml-1 font-semibold">(原生)</span>}
                                    </p>
                                )}
                            </div>
                        )}
                        
                        {battleMode === 'scenario' && (<div className="mb-6">
                            <button onClick={() => setIsScenarioPasteAreaVisible(!isScenarioPasteAreaVisible)} className="text-purple-700 hover:underline cursor-pointer mb-2 font-semibold">
                                {isScenarioPasteAreaVisible ? '▼ 折叠情景粘贴区域' : '▶ 展开情景粘贴区域 (手机端推荐)'}
                            </button>
                            {isScenarioPasteAreaVisible && (
                                <div className="input-group mt-2">
                                    <textarea value={pastedScenarioJson} onChange={(e) => setPastedScenarioJson(e.target.value)} placeholder="在此处粘贴一个情景的设定文件(.json)内容..." className="input-field resize-y h-24" disabled={isGenerating} />
                                    <button onClick={handlePasteAndLoadScenario} disabled={!pastedScenarioJson.trim() || isGenerating} className="generate-button mt-2 mb-0" style={{ backgroundColor: '#8b5cf6', backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)' }}>从文本加载情景</button>
                                </div>
                            )}
                                <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
                                    <p className="font-bold">你已选择【情景模式】！</p>
                                    <p className="mt-1">选择一个情景数据卡或上传情景文件，让角色们在自定义的舞台上展开故事吧！</p>
                                </div>
                            </div>
                        )}
                        {
                            // TODO: 调试中，暂时关闭该功能
                            false && <AiProviderSelector onConfigChange={setUserProviderConfig} />
                        }
                        {/* 历战记录 / 当前状态策略 */}
                        <div className="input-group">
                            <label className="input-label">资料读写策略</label>
                            <div className="grid gap-4 md:grid-cols-2">
                                <fieldset className="border border-gray-200 rounded-lg p-3">
                                    <legend className="text-xs font-semibold text-gray-600 px-1">历战记录</legend>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                                            checked={readArenaHistory}
                                            onChange={(e) => setReadArenaHistory(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        生成时读取
                                    </label>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                                            checked={writeArenaHistory}
                                            onChange={(e) => setWriteArenaHistory(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        战报后写入
                                    </label>
                                    {readArenaHistory && (
                                        <div className="mt-3 space-y-2">
                                            <label className="block text-xs font-semibold text-gray-600">单个角色读取条数</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    step={1}
                                                    className="input-field w-24"
                                                    value={readArenaHistoryLimit}
                                                    onChange={(e) => setReadArenaHistoryLimit(e.target.value.replace(/[^0-9]/g, '') || '1')}
                                                    disabled={isGenerating || isArenaHistoryUnlimited}
                                                />
                                                <label className="flex items-center text-xs text-gray-600">
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                                                        checked={isArenaHistoryUnlimited}
                                                        onChange={(e) => setIsArenaHistoryUnlimited(e.target.checked)}
                                                        disabled={isGenerating}
                                                    />
                                                    无上限
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-[11px] text-gray-500 mt-1">关闭读取后，将不会参考角色历战；关闭写入后，本次战绩不会被记录。</p>
                                </fieldset>
                                <fieldset className="border border-gray-200 rounded-lg p-3">
                                    <legend className="text-xs font-semibold text-gray-600 px-1">当前状态</legend>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                                            checked={readCurrentState}
                                            onChange={(e) => setReadCurrentState(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        生成时读取
                                    </label>
                                    <label className="flex items-center text-sm text-gray-700 mt-2">
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                                            checked={writeCurrentState}
                                            onChange={(e) => setWriteCurrentState(e.target.checked)}
                                            disabled={isGenerating}
                                        />
                                        战报后写入
                                    </label>
                                    <p className="text-[11px] text-gray-500 mt-1">当前状态用于追踪角色身体状况、物品、人际等即时信息。写入时仅更新摘要，既有自定义字段不会被覆盖。</p>
                                </fieldset>
                            </div>
                            {shouldWarnHistoryLimit && (
                                <p className="text-xs text-orange-600 mt-2">
                                    ⚠️ 当前设置预计将读取{numericHistoryLimit === Infinity ? '无限制数量的' : `约 ${Math.ceil(estimatedHistoryTotal)} 条`}历战记录，超过 20 条可能显著提高生成失败或超时概率。
                                </p>
                            )}
                            <p className="text-xs text-gray-500 mt-2">偏好保存在浏览器端，流式与普通模式共享同一配置。</p>
                        </div>


                        {/* --- 在非日常模式下显示等级选择 --- */}
                        {battleMode !== 'daily' && (
                            <div className="input-group">
                                <label htmlFor="level-select" className="input-label">指定平均等级 (可选):</label>
                                <select id="level-select" value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} className="input-field" style={{ cursor: 'pointer' }} disabled={isGenerating}>
                                    {battleLevels.map(level => (<option key={level.value} value={level.value}>{level.label}</option>))}
                                </select>
                                <p className="text-xs text-gray-500 mt-1">默认由 AI 根据角色强度自动分配，以保证战斗平衡和观赏性。</p>
                            </div>
                        )}

                        {/* 故事方向引导输入框 */}
                        {appConfig.ENABLE_ARENA_USER_GUIDANCE && (
                            <div className="input-group">
                                <label htmlFor="user-guidance" className="input-label">故事方向引导 (可选)</label>
                                <input
                                    id="user-guidance"
                                    type="text"
                                    value={userGuidance}
                                    onChange={(e) => setUserGuidance(e.target.value)}
                                    className="input-field"
                                    placeholder="输入关键词或一句话 (最多50字)"
                                    maxLength={50}
                                    disabled={isGenerating}
                                />
                                <p className="text-xs text-gray-500 mt-1">尝试引导AI生成您想看的故事，例如：“在雨中相遇”、“保卫要地”、“猫咖聚会”等。</p>
                            </div>
                        )}

                        {/* v0.4.0: 增强型判定器 */}
                        <div className="input-group">
                            <h3 className="input-label">🎲 随机判定器 (可选)</h3>
                            <AdjudicatorEditor events={adjudicationEvents} onEventsChange={setAdjudicationEvents} />
                        </div>


                        {/* [FR-5] 字数选择 UI */}
                        <div className="input-group">
                            <label className="input-label">期望字数</label>
                            <div className="flex flex-wrap gap-2">
                                {[{ v: 'default', l: '默认' }, { v: 'short', l: '简短(300+)' }, { v: 'standard', l: '标准(600+)' }, { v: 'detailed', l: '详细(1000+)' }, { v: 'long', l: '长篇(2000+)' }].map(opt => (
                                    <button
                                        key={opt.v}
                                        onClick={() => setStoryLength(opt.v)}
                                        disabled={isGenerating}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${storyLength === opt.v ? 'bg-pink-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                    >
                                        {opt.l}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/*语言选择下拉菜单*/}
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

                        {/* 轻量模型选项 */}
                        <div className="input-group">
                            <label className="flex items-center text-sm font-medium text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isDowngrade}
                                    onChange={(e) => setIsDowngrade(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500 mr-2 disabled:opacity-50"
                                    disabled={isGenerating}
                                />
                                使用轻量模型
                            </label>
                            <p className="text-xs text-gray-500 mt-1">
                                启用后可显著提高成功率和速度，但可能降低输出质量。
                            </p>
                        </div>

                        <button onClick={handleGenerate}
                            // --- 根据模式动态判断禁用条件 ---
                            disabled={
                                isGenerating ||
                                isCooldown ||
                                (battleMode === 'daily' || battleMode === 'scenario' ? combatants.length < 1 : combatants.length < 2)
                            }
                            className="generate-button"
                        >
                            {getButtonText()}
                        </button>
                        <div className="text-center mt-3">
                            <a
                                href="https://qun.qq.com/universal-share/share?ac=1&busi_data=eyJncm91cENvZGUiOiIxMDU5ODMwOTUyIiwidG9rZW4iOiJNUFN6UVpBRVZNNU9COWpBa21DU1lxczRObXhiKy9kSzEvbHhOcnNpT1RBZUVVU3dtZ2hUQjJVNGtuYk5ISDhrIiwidWluIjoiMTAxOTcyNzcxMCJ9&data=DxfxSXDeGY3mgLKqoTGEoHkfqpums19TEW8Alu5Ikc3uCmV0O8YkLVLyRTMOp61VjFN387-7QL8-j2AFHUX2QXq525oXb8rl0lNhm0K453Q&svctype=5&tempid=h5_group_info"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline font-semibold"
                            >
                                点击加入QQ交流群
                            </a>
                        </div>
                        <div className="text-center mt-3">
                            <a
                                href="https://pd.qq.com/s/brisxifbl"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline font-semibold"
                            >
                                点击加入腾讯频道
                            </a>
                        </div>
                        {error && <div className={`p-4 rounded-md my-4 text-sm whitespace-pre-wrap ${error.startsWith('❌') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{error}</div>}
                    </div>

                    {/* v0.4.0 判定结果展示 */}
                    {adjudicationResults && (
                        <div className="card mt-6">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">🎲 随机判定结果</h3>
                            <div className="space-y-2">
                                {adjudicationResults.map((res, index) => (
                                    <div key={index} className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm"
                                        style={{ marginLeft: `${res.depth * 20}px` }}>
                                        {res.depth > 0 && <span className="text-gray-400">↳ </span>}
                                        <span className="font-semibold text-gray-700">{res.description}</span>
                                        <p className="text-gray-600 mt-1">
                                            判定结果: <span className={`font-bold ${res.outcome === '成功' || res.outcome === '大成功' ? 'text-green-600' : res.outcome === '失败' || res.outcome === '大失败' ? 'text-red-600' : 'text-blue-600'
                                                }`}>{res.outcome}</span> ({res.details})
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}


                    {newsReport && (
                        <div className="space-y-3 mt-6">
                            {isStreaming && (
                                <div className="px-4 py-2 bg-purple-50 border border-purple-200 text-purple-700 text-sm rounded">
                                    正在流式生成故事，正文会实时刷新，请稍候片刻……
                                </div>
                            )}
                            <BattleReportCard
                                report={newsReport}
                                onSaveImage={handleSaveImage}
                                mode={battleMode}
                                liveBody={liveArticleBody ?? undefined}
                            />
                        </div>
                    )}

                    {/* --- 更新后的角色信息展示区域 --- */}
                    {updatedCombatants.length > 0 && (
                        <div className="card mt-6">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">角色更新</h3>
                            <div className="space-y-4">
                                {updatedCombatants.map((charData) => {
                                    const entries = charData.arena_history?.entries;
                                    const latestEntry = Array.isArray(entries) && entries.length > 0 ? entries[entries.length - 1] : null;
                                    const stateSummary = charData.current_state?.summary?.trim();
                                    const name = getCombatantDisplayName(charData);
                                    const template = inferTemplate(charData);
                                    const typeDisplay = template === 'magical-girl'
                                        ? '魔法少女'
                                        : template === 'canshou'
                                            ? '残兽'
                                            : '通用角色';

                                    const hasHistoryUpdate = !!latestEntry;
                                    const hasStateUpdate = !!stateSummary;

                                    if (!hasHistoryUpdate && !hasStateUpdate) return null;

                                    return (
                                        <div key={name} className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <p className="font-semibold text-gray-700">{name} <span className="text-xs text-gray-500">({typeDisplay})</span></p>
                                                    <p className="text-sm text-gray-600 mt-1">
                                                        <span className="font-medium">历战记录：</span>
                                                        {hasHistoryUpdate ? latestEntry.impact : '已跳过写入，改为仅更新其它字段。'}
                                                    </p>
                                                    {hasStateUpdate && (
                                                        <p className="text-sm text-gray-600 mt-1">
                                                            <span className="font-medium">当前状态：</span>
                                                            {stateSummary}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 mt-2 justify-end">
                                                <button
                                                    onClick={() => downloadUpdatedJson(charData)}
                                                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors shrink-0"
                                                >
                                                    下载更新设定
                                                </button>
                                                <SaveToCloudButton
                                                    data={charData}
                                                    buttonText="保存到云端"
                                                    className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors shrink-0"
                                                    style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* --- 统计数据 --- */}
                    {appConfig.SHOW_STAT_DATA && (
                        <>
                            {isLoadingStats ? (
                                <div className="card mt-6 text-center text-gray-500">正在加载数据中心...</div>
                            ) : stats ? (
                                <div className="card mt-6">
                                    <h3 className="text-xl font-bold text-gray-800 text-center mb-4">
                                        竞技场数据中心
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4 text-center mb-6">
                                        <div className="p-4 bg-gray-100 rounded-lg">
                                            <p className="text-2xl font-bold text-pink-500">{stats.totalBattles || 0}</p>
                                            <p className="text-sm text-gray-600">故事/战斗总场数</p>
                                        </div>
                                        <div className="p-4 bg-gray-100 rounded-lg">
                                            <p className="text-2xl font-bold text-blue-500">{stats.totalParticipants || 0}</p>
                                            <p className="text-sm text-gray-600">总登场人次</p>
                                        </div>
                                    </div>
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <Leaderboard title="🏆 胜率排行榜" data={stats.winRateRank || []} presetInfo={presetInfo} />
                                        <Leaderboard title="⚔️ 登场数排行榜" data={stats.participationRank || []} presetInfo={presetInfo} />
                                        <Leaderboard title="🥇 胜利榜" data={stats.winsRank || []} presetInfo={presetInfo} />
                                        <Leaderboard title="💔 战败榜" data={stats.lossesRank || []} presetInfo={presetInfo} />
                                    </div>
                                </div>
                            ) : (
                                <div className="card mt-6 text-center text-gray-500">
                                    <p>数据库还未初始化或暂无数据</p>
                                    <p className="text-sm mt-2">开始使用竞技场功能后，这里将显示统计数据</p>
                                    <p className="text-xs mt-2 text-red-500">请在 Cloudflare D1 控制台执行建表 SQL 语句</p>
                                </div>
                            )}
                        </>
                    )}

                    <div className="text-center" style={{ marginTop: '2rem' }}>
                        <button onClick={() => router.push('/')} className="footer-link">
                            返回首页
                        </button>
                    </div>

                    <Footer />
                </div>

                {/* 图片模态框 */}
                {showImageModal && savedImageUrl && (
                    <div className="fixed inset-0 bg-black flex items-center justify-center z-50"
                        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem' }}
                    >
                        <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
                            <div className="flex justify-between items-center m-0">
                                <div></div>
                                <button
                                    onClick={() => setShowImageModal(false)}
                                    className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                                    style={{ marginRight: '0.5rem' }}
                                >
                                    ×
                                </button>
                            </div>
                            <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
                                📱 长按图片保存到相册
                            </p>
                            <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
                                <img
                                    src={savedImageUrl}
                                    alt="魔法少女战斗报告"
                                    className="w-full h-auto rounded-lg mx-auto"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 数据库数据选择模态框 */}
            <BattleDataModal
                isOpen={showBattleDataModal}
                onClose={() => setShowBattleDataModal(false)}
                onSelectCard={handleSelectDataCard}
                selectedType={dataModalType}
            />
        </>
    );
};

export default BattlePage;
