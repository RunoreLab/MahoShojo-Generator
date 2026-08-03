'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  type GameCardFaceData,
  type GameCardMetadata,
  GAME_CARD_TEMPLATE_ID,
  RARITY_LABELS,
  CARD_TYPE_LABELS,
  ELEMENT_LABELS,
} from '@/lib/schemas/game-card';
import { GameCardFace } from '@/components/game-card/GameCardFace';
import { ErrorMessage } from '@/components/ErrorMessage';
import { authStorage } from '@/lib/auth';
import { downloadBlob } from '@/lib/client/blobUrl';

type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

interface ApiResponse {
  faceData?: GameCardFaceData;
  sourceCardKind?: string;
  error?: string;
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
  const [themeColorOverride, setThemeColorOverride] = useState<string | null>(null);
  const [imageTab, setImageTab] = useState<'upload' | 'tachie'>('upload');
  const [tachiePrompt, setTachiePrompt] = useState('');
  const [tachieStatus, setTachieStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [tachieError, setTachieError] = useState<string | null>(null);

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

  const effectiveFaceData = useMemo(() => {
    if (!faceData) return null;
    if (themeColorOverride) {
      return { ...faceData, themeColor: themeColorOverride };
    }
    return faceData;
  }, [faceData, themeColorOverride]);

  const handleGenerate = useCallback(async () => {
    if (!sourceCardJson.trim()) {
      setGenError('请先输入或导入数据卡 JSON');
      setGenStatus('error');
      return;
    }
    setGenStatus('generating');
    setGenError(null);
    try {
      const authHeader = await authStorage.getAuthHeader();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const resp = await fetch('/api/generate-game-card', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sourceCardJson: sourceCardJson.trim(),
          customInstructions: customInstructions.trim() || undefined,
        }),
      });

      const json: ApiResponse = await resp.json();
      if (!resp.ok || !json.faceData) {
        throw new Error(json.error ?? `请求失败 (${resp.status})`);
      }

      setFaceData(json.faceData);
      setSourceCardKind(json.sourceCardKind ?? null);
      setThemeColorOverride(null);
      setGenStatus('success');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
      setGenStatus('error');
    }
  }, [sourceCardJson, customInstructions]);

  const handleLoadSample = () => {
    setSourceCardJson(SAMPLE_CARD_JSON);
  };

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
    const reader = new FileReader();
    reader.onload = () => {
      setImageUrl(String(reader.result ?? ''));
      setImageSource('uploaded');
    };
    reader.readAsDataURL(file);
  };

  const handleTachieGenerate = useCallback(async () => {
    if (!tachiePrompt.trim()) {
      setTachieError('请输入提示词');
      setTachieStatus('error');
      return;
    }
    setTachieStatus('generating');
    setTachieError(null);
    try {
      const authHeader = await authStorage.getAuthHeader();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const resp = await fetch('/api/tachie/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'modelscope',
          prompt: `${tachiePrompt.trim()}, 二次元, 精致立绘`,
          modelscopeModel: 'Stonego/XiabanmostyleV3',
          modelscopeSize: '928x1664',
        }),
      });

      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error ?? `立绘生成请求失败 (${resp.status})`);
      }

      const generateUuid = json.generateUuid ?? json.taskId;
      if (!generateUuid) {
        throw new Error('未获取到生成任务 ID');
      }

      const statusResp = await fetch(`/api/tachie/status?uuid=${encodeURIComponent(generateUuid)}&source=modelscope`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      const statusJson = await statusResp.json();

      if (statusJson.imageUrl) {
        setImageUrl(statusJson.imageUrl);
        setImageSource('generated');
        setTachieStatus('success');
      } else {
        setTachieError('立绘生成中，请稍后在此页面刷新或使用上传方式');
        setTachieStatus('error');
      }
    } catch (err) {
      setTachieError(err instanceof Error ? err.message : String(err));
      setTachieStatus('error');
    }
  }, [tachiePrompt]);

  const handleExportJson = useCallback(() => {
    if (!effectiveFaceData) return;
    const metadata: GameCardMetadata = {
      templateId: GAME_CARD_TEMPLATE_ID,
      faceData: effectiveFaceData,
      imageUrl,
      imageSource: imageSource ?? null,
      sourceCardType: sourceCardKind ?? undefined,
      createdAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const sanitized = effectiveFaceData.cardName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    downloadBlob(blob, `卡牌_${sanitized}.json`);
  }, [effectiveFaceData, imageUrl, imageSource, sourceCardKind]);

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const face = parsed.faceData ?? parsed;
        if (face && face.cardName && face.rarity) {
          setFaceData(face);
          if (parsed.imageUrl) {
            setImageUrl(parsed.imageUrl);
            setImageSource(parsed.imageSource ?? 'uploaded');
          }
          setGenStatus('success');
        } else {
          setGenError('导入的 JSON 不包含有效的卡牌卡面数据');
          setGenStatus('error');
        }
      } catch {
        setGenError('JSON 解析失败');
        setGenStatus('error');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="magic-background-white min-h-screen pb-12">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* 标题 */}
        <div className="pt-6 pb-4 text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            卡牌工坊
          </h1>
          <p className="text-sm text-gray-600">
            将角色卡 / 情景卡数据转化为卡牌游戏风格的精美卡面
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：输入区 */}
          <div className="space-y-4">
            {/* 数据卡输入 */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">数据卡输入</h2>
                <div className="flex gap-2">
                  <label className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded cursor-pointer hover:bg-blue-100 transition-colors">
                    导入 JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                  <button
                    onClick={handleLoadSample}
                    className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                  >
                    示例
                  </button>
                </div>
              </div>
              <textarea
                value={sourceCardJson}
                onChange={(e) => setSourceCardJson(e.target.value)}
                placeholder="粘贴角色卡 / 情景卡的 JSON 数据，或点击右上角导入文件 / 加载示例"
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

              <button
                onClick={handleGenerate}
                disabled={genStatus === 'generating' || !sourceCardJson.trim()}
                className="generate-button w-full"
              >
                {genStatus === 'generating' ? '生成中...' : '🎴 生成卡牌卡面'}
              </button>

              {genStatus === 'error' && genError && (
                <ErrorMessage message={genError} />
              )}
            </div>

            {/* 插图设置 */}
            <div className="card p-4 space-y-3">
              <h2 className="text-lg font-semibold text-gray-800">插图设置</h2>

              <div className="flex gap-2">
                <button
                  onClick={() => setImageTab('upload')}
                  className={`flex-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    imageTab === 'upload'
                      ? 'bg-pink-100 text-pink-700 font-medium'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  上传图片
                </button>
                <button
                  onClick={() => setImageTab('tachie')}
                  className={`flex-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    imageTab === 'tachie'
                      ? 'bg-pink-100 text-pink-700 font-medium'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  AI 立绘生成
                </button>
              </div>

              {imageTab === 'upload' && (
                <div className="space-y-2">
                  <label className="block">
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-pink-400 transition-colors">
                      {imageUrl && imageSource === 'uploaded' ? (
                        <div className="space-y-2">
                          <img src={imageUrl} alt="预览" className="max-h-32 mx-auto rounded" />
                          <p className="text-xs text-gray-500">点击重新选择</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-3xl">🖼️</p>
                          <p className="text-sm text-gray-500">点击选择图片文件</p>
                          <p className="text-xs text-gray-400">支持 PNG / JPG / WebP</p>
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
                      onClick={() => { setImageUrl(null); setImageSource(null); }}
                      className="text-xs text-red-500 hover:underline"
                    >
                      移除图片
                    </button>
                  )}
                </div>
              )}

              {imageTab === 'tachie' && (
                <div className="space-y-2">
                  <textarea
                    value={tachiePrompt}
                    onChange={(e) => setTachiePrompt(e.target.value)}
                    placeholder="输入角色外观描述，用于生成立绘插图"
                    className="input-field w-full text-sm"
                    rows={3}
                    style={{ resize: 'vertical' }}
                  />
                  <button
                    onClick={handleTachieGenerate}
                    disabled={tachieStatus === 'generating'}
                    className="generate-button w-full text-sm"
                  >
                    {tachieStatus === 'generating' ? '生成中...' : '🎨 生成立绘'}
                  </button>
                  {tachieStatus === 'error' && tachieError && (
                    <p className="text-xs text-red-500">{tachieError}</p>
                  )}
                  {tachieStatus === 'success' && (
                    <p className="text-xs text-green-600">立绘生成成功！</p>
                  )}
                  <p className="text-xs text-gray-400">
                    注：立绘生成通过 ModelScope 异步执行，可能需要等待一段时间。如生成未立即完成，可稍后重试或使用上传方式。
                  </p>
                </div>
              )}
            </div>

            {/* 主题色 */}
            {effectiveFaceData && (
              <div className="card p-4 space-y-3">
                <h2 className="text-lg font-semibold text-gray-800">主题色</h2>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
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
                  <label className="w-8 h-8 rounded-full border-2 border-gray-300 cursor-pointer flex items-center justify-center overflow-hidden">
                    <input
                      type="color"
                      value={themeColorOverride ?? effectiveFaceData.themeColor}
                      onChange={(e) => setThemeColorOverride(e.target.value)}
                      className="opacity-0 absolute w-8 h-8"
                    />
                    <span className="text-xs">🎨</span>
                  </label>
                </div>
              </div>
            )}

            {/* 导入/导出 */}
            {effectiveFaceData && (
              <div className="card p-4 space-y-3">
                <h2 className="text-lg font-semibold text-gray-800">导出 / 导入</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportJson}
                    className="flex-1 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 transition-colors"
                  >
                    导出元数据 JSON
                  </button>
                  <label className="flex-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors cursor-pointer text-center">
                    导入元数据 JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportJson}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：预览区 */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="card p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 text-center">卡面预览</h2>
              {effectiveFaceData ? (
                <div className="flex flex-col items-center">
                  <GameCardFace
                    faceData={effectiveFaceData}
                    imageUrl={imageUrl}
                    imageSaveMode="auto"
                  />

                  {/* 元数据摘要 */}
                  <div className="mt-4 w-full grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <span className="text-gray-500">稀有度</span>
                      <span className="ml-2 font-medium text-gray-800">
                        {RARITY_LABELS[effectiveFaceData.rarity]}
                      </span>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <span className="text-gray-500">类型</span>
                      <span className="ml-2 font-medium text-gray-800">
                        {CARD_TYPE_LABELS[effectiveFaceData.cardType]}
                      </span>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <span className="text-gray-500">属性</span>
                      <span className="ml-2 font-medium text-gray-800">
                        {ELEMENT_LABELS[effectiveFaceData.element]}
                      </span>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <span className="text-gray-500">花费</span>
                      <span className="ml-2 font-medium text-gray-800">
                        {effectiveFaceData.cost}
                      </span>
                    </div>
                    {sourceCardKind && (
                      <div className="bg-gray-50 rounded-lg p-2 col-span-2">
                        <span className="text-gray-500">源卡类型</span>
                        <span className="ml-2 font-medium text-gray-800">{sourceCardKind}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <span className="text-5xl mb-3">🎴</span>
                  <p className="text-sm">输入数据卡并点击&ldquo;生成卡牌卡面&rdquo;</p>
                  <p className="text-xs mt-1">生成的卡面将在此处预览</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
