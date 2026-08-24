'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  type GameCardFaceData,
  type GameCardImageAspectRatio,
} from '@/lib/schemas/game-card';
import {
  RARITY_LABELS,
  CARD_TYPE_LABELS,
  ELEMENT_LABELS,
} from '@/lib/game-card/presentation';
import { GameCardFace, type ImageTransform, DEFAULT_IMAGE_TRANSFORM } from '@/components/game-card/GameCardFace';
import { ImageCropEditor } from '@/components/card-forge/ImageCropEditor';
import BattleDataModal from '@/components/BattleDataModal';
import { ErrorMessage } from '@/components/ErrorMessage';
import { StreamStopButton } from '@/components/shared/StreamStopButton';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import { normalizeModelScopeToken } from '@/lib/tachie/modelscope/error';
import { authStorage } from '@/lib/auth';
import { generationApiFetch } from '@/lib/hono-api-client';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';
import { downloadBlob } from '@/lib/client/blobUrl';
import { resolveApiErrorMessage, readJsonOrTextFromResponse } from '@/lib/client/apiError';
import { isAbortErrorLike, STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import {
  DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO,
} from '@/lib/game-card/image-crop';
import {
  parseGameCardForgeImport,
  serializeGameCardForgeDocument,
} from '@/lib/card-forge/document';
import {
  estimateImageDataUrlByteLength,
  getImageSizeWarning,
  imageUrlToDataUrl,
} from '@/lib/card-forge/image-data';
import { applyShieldWordsToGameCardFaceData } from '@/lib/card-forge/content-safety';
import { formatSelectedDataCardJson } from '@/lib/card-forge/source-card';
import { quickCheck } from '@/lib/sensitive-word-filter';

type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

interface ApiResponse {
  faceData?: GameCardFaceData;
  sourceCardKind?: string;
  error?: string;
  message?: string;
  details?: string;
}

const SAMPLE_CARD_JSON = JSON.stringify(
  {
    templateId: '魔法少女/心之花/魔法少女（名字生成）',
    codename: '蔷薇荆棘',
    appearance: {
      outfit: '深红色的哥特萝莉裙装，裙摆如盛开的玫瑰',
      accessories: '荆棘冠冕，右手佩戴蔷薇纹章戒指',
      colorScheme: '深红、黑色、金色',
      overallLook: '优雅而危险的暗系魔法少女',
    },
    magicConstruct: {
      name: '血蔷薇之镰',
      form: '巨大的镰刀，刀刃如花瓣展开',
      basicAbilities: ['荆棘缠绕：召唤蔷薇藤蔓束缚敌人', '血之斩击：镰刀挥出红色弧光'],
      description: '由千年蔷薇的荆棘编织而成的魔力武器',
    },
    wonderlandRule: {
      name: '荆棘花园',
      description: '在周围生成蔷薇花园，踏入的敌人将被荆棘缠绕',
      tendency: '控制',
      activation: '被动触发',
    },
    blooming: {
      name: '猩红女皇',
      evolvedAbilities: ['猩红领域：范围内敌人持续流血', '蔷薇葬礼：终结技，引爆所有荆棘'],
      evolvedForm: '全身被猩红蔷薇覆盖的女皇形态',
      evolvedOutfit: '华丽的猩红色礼服，荆棘化作披风',
      powerLevel: 'S',
    },
    analysis: {
      personalityAnalysis: '外冷内热，对同伴极为忠诚，对敌人毫不留情',
      abilityReasoning: '以控制为主，兼具持续伤害和爆发能力',
      coreTraits: ['忠诚', '冷酷', '优雅', '致命'],
      predictionBasis: '荆棘主题暗示控制与持续伤害',
    },
  },
  null,
  2,
);

const PRESET_COLORS = [
  '#ff6b9d', '#ef4444', '#f59e0b', '#10b981',
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
];

const MODELSCOPE_SIZE_OPTIONS = [
  { value: '928x1664', label: '16:9 竖屏（928×1664）' },
  { value: '1664x928', label: '16:9 横屏（1664×928）' },
  { value: '1328x1328', label: '正方形（1328×1328）' },
  { value: '1104x1472', label: '4:3 竖屏（1104×1472）' },
  { value: '1472x1104', label: '4:3 横屏（1472×1104）' },
] as const;

type ModelScopePresetSize = (typeof MODELSCOPE_SIZE_OPTIONS)[number]['value'];

const DEFAULT_MODELSCOPE_SIZE: ModelScopePresetSize = '1328x1328';

const isModelScopePresetSize = (value: unknown): value is ModelScopePresetSize =>
  typeof value === 'string' && MODELSCOPE_SIZE_OPTIONS.some((option) => option.value === value);

const TACHIE_CREDENTIALS_KEY = 'card-forge-tachie-credentials';
const TACHIE_REMEMBER_KEY = 'card-forge-tachie-remember';

const DEFAULT_MODELSCOPE_MODEL = 'Stonego/XiabanmostyleV3';

interface TachieCredentials {
  modelscopeToken: string;
  modelscopeModel: string;
  modelscopeSize: ModelScopePresetSize;
}

function loadTachieCredentials(): TachieCredentials | null {
  try {
    const remember = localStorage.getItem(TACHIE_REMEMBER_KEY);
    if (remember !== 'true') return null;
    const raw = localStorage.getItem(TACHIE_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TachieCredentials>;
    return {
      modelscopeToken: typeof parsed.modelscopeToken === 'string' ? parsed.modelscopeToken : '',
      modelscopeModel: typeof parsed.modelscopeModel === 'string' && parsed.modelscopeModel.trim()
        ? parsed.modelscopeModel
        : DEFAULT_MODELSCOPE_MODEL,
      modelscopeSize: isModelScopePresetSize(parsed.modelscopeSize) ? parsed.modelscopeSize : DEFAULT_MODELSCOPE_SIZE,
    };
  } catch {
    return null;
  }
}

function saveTachieCredentials(creds: TachieCredentials) {
  try {
    localStorage.setItem(TACHIE_CREDENTIALS_KEY, JSON.stringify(creds));
    localStorage.setItem(TACHIE_REMEMBER_KEY, 'true');
  } catch {
    /* ignore */
  }
}

function clearTachieCredentials() {
  try {
    localStorage.removeItem(TACHIE_CREDENTIALS_KEY);
    localStorage.setItem(TACHIE_REMEMBER_KEY, 'false');
  } catch {
    /* ignore */
  }
}

export function CardForgePage() {
  const searchParams = useSearchParams();
  const [sourceCardJson, setSourceCardJson] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [faceData, setFaceData] = useState<GameCardFaceData | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<'uploaded' | 'data-card' | 'generated' | null>(null);
  const [sourceCardKind, setSourceCardKind] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<GenerationStatus>('idle');
  const [genError, setGenError] = useState<string | null>(null);
  const [genErrorStatus, setGenErrorStatus] = useState<number | null>(null);
  const [themeColorOverride, setThemeColorOverride] = useState<string | null>(null);
  const [imageTab, setImageTab] = useState<'upload' | 'tachie'>('upload');
  const [tachiePrompt, setTachiePrompt] = useState('');
  const [tachieStatus, setTachieStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [tachieError, setTachieError] = useState<string | null>(null);

  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);

  const [modelscopeToken, setModelscopeToken] = useState('');
  const [modelscopeModel, setModelscopeModel] = useState(DEFAULT_MODELSCOPE_MODEL);
  const [modelscopeSize, setModelscopeSize] = useState<ModelScopePresetSize>(DEFAULT_MODELSCOPE_SIZE);
  const [rememberTachieCreds, setRememberTachieCreds] = useState(false);

  const [imageTransform, setImageTransform] = useState<ImageTransform>(DEFAULT_IMAGE_TRANSFORM);
  const [imageAspectRatio, setImageAspectRatio] = useState<GameCardImageAspectRatio>(DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO);
  const [isDataCardModalOpen, setIsDataCardModalOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [cardForgeFileError, setCardForgeFileError] = useState<string | null>(null);
  const [imageSizeWarning, setImageSizeWarning] = useState<string | null>(null);
  const genAbortRef = useRef<AbortController | null>(null);
  const tachieAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = loadTachieCredentials();
    if (saved) {
      setModelscopeToken(saved.modelscopeToken);
      setModelscopeModel(saved.modelscopeModel);
      setModelscopeSize(saved.modelscopeSize);
      setRememberTachieCreds(true);
    }
  }, []);

  useEffect(() => {
    if (!searchParams) return;
    const preset = searchParams.get('source');
    if (preset === 'sample') {
      setSourceCardJson(SAMPLE_CARD_JSON);
    }
    const dataParam = searchParams.get('data');
    if (dataParam) {
      try {
        const decoded = decodeURIComponent(dataParam);
        setSourceCardJson(decoded);
      } catch {
        /* ignore */
      }
    } else {
      try {
        const stored = sessionStorage.getItem('card-forge-source-data');
        if (stored) {
          setSourceCardJson(stored);
          sessionStorage.removeItem('card-forge-source-data');
        }
      } catch {
        /* ignore */
      }
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      genAbortRef.current?.abort();
      tachieAbortRef.current?.abort();
    };
  }, []);

  const effectiveFaceData = useMemo(() => {
    if (!faceData) return null;
    if (themeColorOverride) {
      return { ...faceData, themeColor: themeColorOverride };
    }
    return faceData;
  }, [faceData, themeColorOverride]);

  const tokenEstimateText = useMemo(() => {
    const parts = [sourceCardJson];
    if (customInstructions.trim()) {
      parts.push(`\n--- 用户附加要求 ---\n${customInstructions}`);
    }
    return parts.join('');
  }, [customInstructions, sourceCardJson]);

  const handleGenerate = useCallback(async () => {
    if (!sourceCardJson.trim()) {
      setGenError('请先输入或导入数据卡 JSON');
      setGenErrorStatus(null);
      setGenStatus('error');
      return;
    }
    setGenStatus('generating');
    setGenError(null);
    setGenErrorStatus(null);

    const abortController = new AbortController();
    genAbortRef.current?.abort();
    genAbortRef.current = abortController;

    let errorStatus: number | null = null;
    try {
      const authHeader = await authStorage.getAuthHeader();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const body: Record<string, unknown> = {
        sourceCardJson: sourceCardJson.trim(),
        customInstructions: customInstructions.trim() || undefined,
      };

      const customProviderPayload = buildCustomProviderRequestPayload(userProviderConfig);
      if (customProviderPayload) {
        body.customProvider = customProviderPayload;
      }

      const resp = await generationApiFetch('/api/generate-game-card', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      const { payload } = await readJsonOrTextFromResponse(resp);
      const json = payload as ApiResponse;

      if (!resp.ok || !json.faceData) {
        errorStatus = resp.status;
        const errorMessage = resolveApiErrorMessage({
          payload,
          fallback: `请求失败 (${resp.status})`,
        });
        throw new Error(errorMessage);
      }

      setFaceData(applyShieldWordsToGameCardFaceData(json.faceData).faceData);
      setSourceCardKind(json.sourceCardKind ?? null);
      setThemeColorOverride(null);
      setGenStatus('success');
    } catch (err) {
      if (isAbortErrorLike(err) || abortController.signal.aborted) {
        setGenStatus('idle');
        return;
      }
      setGenError(err instanceof Error ? err.message : String(err));
      setGenErrorStatus(errorStatus);
      setGenStatus('error');
    }
  }, [sourceCardJson, customInstructions, userProviderConfig]);

  const handleStopGeneration = useCallback(() => {
    genAbortRef.current?.abort(STREAM_ABORT_REASON_USER);
  }, []);

  const handleLoadSample = () => {
    setSourceCardJson(SAMPLE_CARD_JSON);
  };

  const handleSelectOnlineDataCard = useCallback((payload: unknown) => {
    setSourceCardJson(formatSelectedDataCardJson(payload));
    setGenError(null);
    setGenErrorStatus(null);
    setGenStatus('idle');
    setIsDataCardModalOpen(false);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSourceCardJson(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      setGenError('文件读取失败');
      setGenStatus('error');
    };
    reader.readAsText(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageSizeWarning(getImageSizeWarning(file.size));
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(String(reader.result ?? ''));
      setImageSource('uploaded');
      setImageTransform(DEFAULT_IMAGE_TRANSFORM);
      setImageAspectRatio(DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO);
    };
    reader.readAsDataURL(file);
  };

  const normalizedModelscopeToken = normalizeModelScopeToken(modelscopeToken);

  const handleTachieGenerate = useCallback(async () => {
    if (!tachiePrompt.trim()) {
      setTachieError('请输入提示词');
      setTachieStatus('error');
      return;
    }
    if (!normalizedModelscopeToken) {
      setTachieError('请填写 ModelScope API 令牌');
      setTachieStatus('error');
      return;
    }
    setTachieStatus('generating');
    setTachieError(null);

    const abortController = new AbortController();
    tachieAbortRef.current?.abort();
    tachieAbortRef.current = abortController;

    if (rememberTachieCreds) {
      saveTachieCredentials({
        modelscopeToken: normalizedModelscopeToken,
        modelscopeModel: modelscopeModel.trim() || DEFAULT_MODELSCOPE_MODEL,
        modelscopeSize,
      });
    }

    try {
      const authHeader = await authStorage.getAuthHeader();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const resp = await fetch('/api/tachie/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'modelscope',
          modelscopeToken: normalizedModelscopeToken,
          prompt: `${tachiePrompt.trim()}, 二次元, 精致立绘`,
          modelscopeModel: modelscopeModel.trim() || DEFAULT_MODELSCOPE_MODEL,
          modelscopeSize,
        }),
        signal: abortController.signal,
      });

      const { payload } = await readJsonOrTextFromResponse(resp);
      const json = payload as { error?: string; message?: string; details?: string; generateUuid?: string; taskId?: string };

      if (!resp.ok) {
        const errorMessage = resolveApiErrorMessage({
          payload,
          fallback: `立绘生成请求失败 (${resp.status})`,
        });
        throw new Error(errorMessage);
      }

      const generateUuid = json.generateUuid ?? json.taskId;
      if (!generateUuid) {
        throw new Error('未获取到生成任务 ID');
      }

      const statusResp = await fetch(
        `/api/tachie/status?uuid=${encodeURIComponent(generateUuid)}&source=modelscope`,
        {
          headers: authHeader ? { Authorization: authHeader } : {},
          signal: abortController.signal,
        },
      );
      const statusJson = await statusResp.json();

      if (statusJson.imageUrl) {
        setImageUrl(statusJson.imageUrl);
        setImageSource('generated');
        setImageTransform(DEFAULT_IMAGE_TRANSFORM);
        setImageAspectRatio(DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO);
        setTachieStatus('success');
      } else {
        setTachieError('立绘生成中，请稍后在此页面刷新或使用上传方式');
        setTachieStatus('error');
      }
    } catch (err) {
      if (isAbortErrorLike(err) || abortController.signal.aborted) {
        setTachieStatus('idle');
        return;
      }
      setTachieError(err instanceof Error ? err.message : String(err));
      setTachieStatus('error');
    }
  }, [tachiePrompt, normalizedModelscopeToken, modelscopeModel, modelscopeSize, rememberTachieCreds]);

  const handleStopTachie = useCallback(() => {
    tachieAbortRef.current?.abort(STREAM_ABORT_REASON_USER);
  }, []);

  const handleExportJson = useCallback(async () => {
    if (!effectiveFaceData || isExportingJson) return;
    setIsExportingJson(true);
    setCardForgeFileError(null);

    try {
      const imageDataUrl = imageUrl ? await imageUrlToDataUrl(imageUrl) : null;
      const imageByteLength = imageDataUrl
        ? estimateImageDataUrlByteLength(imageDataUrl)
        : null;
      if (imageByteLength !== null) {
        setImageSizeWarning(getImageSizeWarning(imageByteLength));
      }
      const json = serializeGameCardForgeDocument({
        faceData: effectiveFaceData,
        imageDataUrl,
        imageSource,
        imageAspectRatio,
        imageTransform,
        createdAt: new Date().toISOString(),
      });
      const sanitized = effectiveFaceData.cardName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
      downloadBlob(
        new Blob([json], { type: 'application/json' }),
        `卡牌_${sanitized}.json`,
      );
    } catch (error) {
      setCardForgeFileError(error instanceof Error ? error.message : '卡面存档导出失败');
    } finally {
      setIsExportingJson(false);
    }
  }, [effectiveFaceData, imageAspectRatio, imageSource, imageTransform, imageUrl, isExportingJson]);

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const imported = parseGameCardForgeImport(JSON.parse(await file.text()));
      const importedSafety = await quickCheck(JSON.stringify(imported.faceData));
      if (importedSafety.hasSensitiveWords) {
        throw new Error('导入的卡面含敏感词，已拒绝载入。');
      }
      setFaceData(applyShieldWordsToGameCardFaceData(imported.faceData).faceData);
      setImageUrl(imported.imageUrl);
      setImageSource(imported.imageSource);
      setImageSizeWarning(
        imported.imageUrl?.startsWith('data:image/')
          ? getImageSizeWarning(Math.floor((imported.imageUrl.length * 3) / 4))
          : null,
      );
      setImageAspectRatio(imported.imageAspectRatio);
      setImageTransform(imported.imageTransform);
      setThemeColorOverride(null);
      setSourceCardKind(null);
      setCardForgeFileError(null);
      setGenError(null);
      setGenErrorStatus(null);
      setGenStatus('success');
    } catch (error) {
      setCardForgeFileError(error instanceof Error ? error.message : '卡面存档导入失败');
    }
  };

  const handleClearTachieCreds = () => {
    clearTachieCredentials();
    setRememberTachieCreds(false);
    setModelscopeToken('');
    setModelscopeModel(DEFAULT_MODELSCOPE_MODEL);
    setModelscopeSize(DEFAULT_MODELSCOPE_SIZE);
  };

  return (
    <div className="card-forge-shell magic-background-white min-h-[100dvh] pb-12">
      <div className="mx-auto px-4 max-w-7xl">
        {/* 标题 */}
        <div className="pt-8 pb-6 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-2 card-forge-title">
            卡牌工坊
          </h1>
          <p className="text-sm text-[var(--app-text-muted)]">
            将角色卡 / 情景卡数据转化为卡牌游戏风格的精美卡面
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(380px,420px)] gap-6 items-start">
          {/* 左侧：输入区 */}
          <div className="space-y-4 min-w-0">
            {/* 数据卡输入 */}
            <section className="card-forge-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-semibold text-[var(--app-text)]">数据卡输入</h2>
                <div className="flex gap-2">
                  <label className="card-forge-chip card-forge-chip-blue cursor-pointer">
                    导入 JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsDataCardModalOpen(true)}
                    className="card-forge-chip card-forge-chip-blue"
                  >
                    浏览线上卡
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    className="card-forge-chip card-forge-chip-neutral"
                  >
                    示例
                  </button>
                </div>
              </div>
              <textarea
                value={sourceCardJson}
                onChange={(e) => setSourceCardJson(e.target.value)}
                placeholder="可直接粘贴角色卡 / 情景卡 JSON，也可从本地文件或线上数据卡填入"
                className="input-field w-full font-mono text-xs"
                rows={10}
                style={{ resize: 'vertical', minHeight: '200px' }}
              />

              <div>
                <label className="input-label text-xs">附加要求（可选）</label>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="例如：希望这张卡偏向控制型、稀有度至少为史诗…"
                  className="input-field w-full text-sm"
                  rows={2}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <TokenIndicator
                text={tokenEstimateText}
                warningText="⚠️ 预计上下文较长，可能更易超时/失败。请结合所选模型的上下文限制自行评估，必要时精简数据卡。"
              />

              {genStatus === 'generating' ? (
                <StreamStopButton onClick={handleStopGeneration} label="停止生成" className="w-full" />
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!sourceCardJson.trim()}
                  className="generate-button w-full"
                >
                  生成卡牌卡面
                </button>
              )}

              {genStatus === 'error' && genError && (
                <ErrorMessage
                  message={genError}
                  status={genErrorStatus}
                  className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                />
              )}
            </section>

            {/* AI 配置面板 */}
            <section className="card-forge-panel rounded-2xl p-5 space-y-4">
              <h2 className="text-lg font-semibold text-[var(--app-text)]">AI 生成配置</h2>
              <AiProviderSelector
                onConfigChange={setUserProviderConfig}
                storageNamespace="card-forge.customProvider"
                label="文本生成模型（卡牌效果生成）"
              />
            </section>

            {/* 插图设置 */}
            <section className="card-forge-panel rounded-2xl p-5 space-y-4">
              <h2 className="text-lg font-semibold text-[var(--app-text)]">插图设置</h2>

              <div className="flex gap-2">
                <button
                  onClick={() => setImageTab('upload')}
                  className={`flex-1 px-3 py-2 text-sm rounded-xl transition-colors ${
                    imageTab === 'upload'
                      ? 'bg-pink-100 text-pink-700 font-medium dark:bg-pink-950/40 dark:text-pink-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400'
                  }`}
                >
                  上传图片
                </button>
                <button
                  onClick={() => setImageTab('tachie')}
                  className={`flex-1 px-3 py-2 text-sm rounded-xl transition-colors ${
                    imageTab === 'tachie'
                      ? 'bg-pink-100 text-pink-700 font-medium dark:bg-pink-950/40 dark:text-pink-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400'
                  }`}
                >
                  AI 立绘生成
                </button>
              </div>

              {imageTab === 'upload' && (
                <div className="space-y-2">
                  <label className="block">
                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-pink-400 transition-colors">
                      {imageUrl && imageSource === 'uploaded' ? (
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-[var(--app-text)]">已选择上传图片</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">点击重新选择，详细构图请在下方裁剪视窗调整</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm text-gray-500 dark:text-gray-400">点击选择图片文件</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">支持 PNG / JPG / WebP</p>
                        </div>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </label>
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setImageUrl(null);
                        setImageSource(null);
                        setImageSizeWarning(null);
                        setImageTransform(DEFAULT_IMAGE_TRANSFORM);
                        setImageAspectRatio(DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO);
                      }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      移除图片
                    </button>
                  )}
                  {imageSizeWarning && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">{imageSizeWarning}</p>
                  )}
                </div>
              )}

              {imageTab === 'tachie' && (
                <div className="space-y-3">
                  {/* ModelScope 配置 */}
                  <div className="space-y-2">
                    <label className="input-label text-xs">
                      ModelScope API 令牌
                      <a
                        href="https://modelscope.cn/my/myaccesstoken"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-[var(--app-accent-strong)] hover:underline"
                      >
                        获取令牌
                      </a>
                    </label>
                    <input
                      type="password"
                      value={modelscopeToken}
                      onChange={(e) => setModelscopeToken(e.target.value)}
                      placeholder="粘贴 ModelScope Access Token（Bearer 前缀会自动去除）"
                      className="input-field w-full text-sm"
                      autoComplete="off"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="input-label text-xs">图片尺寸</label>
                      <select
                        value={modelscopeSize}
                        onChange={(e) => setModelscopeSize(e.target.value as ModelScopePresetSize)}
                        className="input-field w-full text-sm"
                      >
                        {MODELSCOPE_SIZE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="input-label text-xs">模型（可选）</label>
                      <input
                        type="text"
                        value={modelscopeModel}
                        onChange={(e) => setModelscopeModel(e.target.value)}
                        placeholder={DEFAULT_MODELSCOPE_MODEL}
                        className="input-field w-full text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--app-text-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rememberTachieCreds}
                        onChange={(e) => {
                          setRememberTachieCreds(e.target.checked);
                          if (!e.target.checked) clearTachieCredentials();
                        }}
                        className="accent-pink-500"
                      />
                      记住令牌（仅存储于本地浏览器）
                    </label>
                    {rememberTachieCreds && (
                      <button
                        onClick={handleClearTachieCreds}
                        className="text-xs text-red-500 hover:underline"
                      >
                        清除已保存
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="input-label text-xs">提示词</label>
                    <textarea
                      value={tachiePrompt}
                      onChange={(e) => setTachiePrompt(e.target.value)}
                      placeholder="输入角色外观描述，用于生成立绘插图"
                      className="input-field w-full text-sm"
                      rows={3}
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                  {tachieStatus === 'generating' ? (
                    <StreamStopButton onClick={handleStopTachie} label="停止生成" className="w-full text-sm" />
                  ) : (
                    <button
                      onClick={handleTachieGenerate}
                      disabled={!normalizedModelscopeToken}
                      className="generate-button w-full text-sm"
                    >
                      生成立绘
                    </button>
                  )}
                  {tachieStatus === 'error' && tachieError && (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                      {tachieError}
                    </div>
                  )}
                  {tachieStatus === 'success' && (
                    <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                      立绘生成成功！
                    </div>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    注：立绘生成通过 ModelScope 异步执行，可能需要等待一段时间。如生成未立即完成，可稍后重试或使用上传方式。
                  </p>
                </div>
              )}

              {imageUrl && (
                <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                  <ImageCropEditor
                    imageUrl={imageUrl}
                    imageAspectRatio={imageAspectRatio}
                    imageTransform={imageTransform}
                    onAspectRatioChange={setImageAspectRatio}
                    onTransformChange={setImageTransform}
                    onReset={() => setImageTransform(DEFAULT_IMAGE_TRANSFORM)}
                  />
                </div>
              )}
            </section>

            {/* 主题色 */}
            {effectiveFaceData && (
              <section className="card-forge-panel rounded-2xl p-5 space-y-4">
                <h2 className="text-lg font-semibold text-[var(--app-text)]">主题色</h2>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setThemeColorOverride(color)}
                      className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          (themeColorOverride ?? effectiveFaceData.themeColor) === color
                            ? '#fff'
                            : 'transparent',
                        boxShadow:
                          (themeColorOverride ?? effectiveFaceData.themeColor) === color
                            ? `0 0 0 2px ${color}`
                            : 'none',
                      }}
                    />
                  ))}
                  <label className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600 cursor-pointer flex items-center justify-center overflow-hidden relative">
                    <input
                      type="color"
                      value={themeColorOverride ?? effectiveFaceData.themeColor}
                      onChange={(e) => setThemeColorOverride(e.target.value)}
                      className="opacity-0 absolute w-8 h-8"
                      aria-label="自定义主题色"
                    />
                    <span className="text-xs">+</span>
                  </label>
                </div>

              </section>
            )}

            {/* 卡面存档 */}
            <section className="card-forge-panel rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--app-text)]">卡面存档</h2>
                <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                  导出会将插图内嵌到 JSON，文件较大但可以离线恢复卡面。
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleExportJson()}
                  disabled={!effectiveFaceData || isExportingJson}
                  className="flex-1 px-3 py-2 bg-green-50 text-green-700 rounded-xl text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:bg-green-950/30 dark:text-green-400"
                >
                  {isExportingJson ? '正在嵌入插图…' : '导出卡面 JSON'}
                </button>
                <label className="flex-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors cursor-pointer text-center dark:bg-blue-950/30 dark:text-blue-400">
                  导入卡面 JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => void handleImportJson(event)}
                  />
                </label>
              </div>
              {cardForgeFileError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                  {cardForgeFileError}
                </div>
              )}
            </section>
          </div>

          {/* 右侧：预览区 */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <section className="card-forge-panel rounded-2xl p-5">
              <h2 className="text-lg font-semibold text-[var(--app-text)] mb-4 text-center">卡面预览</h2>
              {effectiveFaceData ? (
                <div className="flex flex-col items-center">
                  <GameCardFace
                    faceData={effectiveFaceData}
                    imageUrl={imageUrl}
                    imageSaveMode="auto"
                    imageTransform={imageTransform}
                    imageAspectRatio={imageAspectRatio}
                    onSaveImage={setPreviewImageUrl}
                  />

                  {/* 元数据摘要 */}
                  <div className="mt-4 w-full grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
                      <span className="text-gray-500 dark:text-gray-400">稀有度</span>
                      <span className="ml-2 font-medium text-[var(--app-text)]">
                        {RARITY_LABELS[effectiveFaceData.rarity]}
                      </span>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
                      <span className="text-gray-500 dark:text-gray-400">类型</span>
                      <span className="ml-2 font-medium text-[var(--app-text)]">
                        {CARD_TYPE_LABELS[effectiveFaceData.cardType]}
                      </span>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
                      <span className="text-gray-500 dark:text-gray-400">属性</span>
                      <span className="ml-2 font-medium text-[var(--app-text)]">
                        {ELEMENT_LABELS[effectiveFaceData.element]}
                      </span>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
                      <span className="text-gray-500 dark:text-gray-400">花费</span>
                      <span className="ml-2 font-medium text-[var(--app-text)]">
                        {effectiveFaceData.cost}
                      </span>
                    </div>
                    {sourceCardKind && (
                      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 col-span-2">
                        <span className="text-gray-500 dark:text-gray-400">源卡类型</span>
                        <span className="ml-2 font-medium text-[var(--app-text)]">{sourceCardKind}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                  <span className="text-5xl mb-3">🎴</span>
                  <p className="text-sm">输入数据卡并点击&ldquo;生成卡牌卡面&rdquo;</p>
                  <p className="text-xs mt-1">生成的卡面将在此处预览</p>
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm text-[var(--app-accent-strong)] hover:underline">
            返回首页
          </Link>
        </div>
      </div>

      <BattleDataModal
        isOpen={isDataCardModalOpen}
        onClose={() => setIsDataCardModalOpen(false)}
        onSelectCard={handleSelectOnlineDataCard}
        selectedType="all"
        allowedTypes={[...ONLINE_DATA_CARD_TYPES]}
        visibleTabs={['my', 'public', 'favorites']}
        initialTab="public"
        selectionMode="single"
        titleOverride="选择数据卡"
      />

      <ImagePreviewModal
        isOpen={previewImageUrl !== null}
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
}
