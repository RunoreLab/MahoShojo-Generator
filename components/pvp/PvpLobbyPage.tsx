'use client';

import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { LayoutList } from 'lucide-react';

import BattleDataModal from '@/components/BattleDataModal';
import Footer from '@/components/Footer';
import { PvpHeroBanner } from '@/components/pvp/PvpHeroBanner';
import { PvpRoomBrowserModal } from '@/components/pvp/PvpRoomBrowserModal';
import { usePvpLobbyStore } from '@/components/pvp/stores/usePvpLobbyStore';
import { BattleModeSelector } from '@/components/shared/BattleModeSelector';
import { GenerationModeSwitcher } from '@/components/shared/GenerationModeSwitcher';
import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';
import { ScenarioPresetGridPicker } from '@/components/ScenarioPresetGridPicker';
import { useScenarioPresetQuery } from '@/components/arena/hooks/useArenaData';
import { authStorage } from '@/lib/auth';
import { inferTemplate } from '@/lib/data-card-converter';
import { mapDataCardRuntimeSourceInfo, mapPublicDataCardRowToBattleSelectionPayload } from '@/lib/data-card-read-mappers';
import { useAuth } from '@/lib/useAuth';
import type { PvpRoomRules, PvpScenarioSelection } from '@/lib/pvp/types';
import type { ScenarioPreset } from '@/lib/scenario-presets';

const PASSWORD_CACHE_PREFIX = 'pvp-room-password:';

const extractRoomIdFromInput = (raw: string): string => {
  const text = raw.trim();
  if (!text) return '';
  const match = text.match(/\/pvp\/([^/?#]+)/i);
  if (match?.[1]) return match[1];
  return text;
};

const saveRoomPassword = (roomId: string, password: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = password.trim();
  if (!trimmed) return;
  sessionStorage.setItem(`${PASSWORD_CACHE_PREFIX}${roomId}`, trimmed);
};

const removePrivateKeys = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removePrivateKeys);
  }
  const cleaned: any = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('_')) {
      cleaned[key] = removePrivateKeys(obj[key]);
    }
  }
  return cleaned;
};

export function PvpLobbyPage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  const rules = usePvpLobbyStore((s) => s.rules);
  const setRules = usePvpLobbyStore((s) => s.setRules);
  const updateRules = usePvpLobbyStore((s) => s.updateRules);
  const [createPassword, setCreatePassword] = useState('');
  const [scenarioSelection, setScenarioSelection] = useState<PvpScenarioSelection | null>(null);
  const [presetScenarioCollapsed, setPresetScenarioCollapsed] = useState(true);
  const [presetScenarioPage, setPresetScenarioPage] = useState(1);
  const [isScenarioMatching, setIsScenarioMatching] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [showRoomBrowserModal, setShowRoomBrowserModal] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isQuickMatching, setIsQuickMatching] = useState(false);

  const scenarioPresetQuery = useScenarioPresetQuery({ enabled: rules.mode === 'scenario' });

  const rulesError = useMemo((): string | null => {
    const participants = Number.isFinite(rules.participants) ? Math.floor(rules.participants) : 0;
    if (participants < 2 || participants > 6) return '人数需要在 2-6 之间。';

    if (rules.submissionMode !== 'hostOnly') {
      const cardsPerPlayer = Number.isFinite(rules.cardsPerPlayer) ? Math.floor(rules.cardsPerPlayer) : 0;
      if (cardsPerPlayer < 0 || cardsPerPlayer > 50) return '每人提交数量需要在 0-50 之间。';
    }

    const dealPerPlayer = Number.isFinite(rules.dealPerPlayer) ? Math.floor(rules.dealPerPlayer) : 0;
    if (dealPerPlayer < 1 || dealPerPlayer > 50) return '每人初始手牌数量需要在 1-50 之间。';

    const dealWhenEmpty = Number.isFinite(rules.dealWhenEmpty) ? Math.floor(rules.dealWhenEmpty) : 0;
    if (dealWhenEmpty < 1 || dealWhenEmpty > 50) return '手牌为空时补发数量需要在 1-50 之间。';

    if (rules.bestOf?.enabled) {
      const maxRounds = Number.isFinite(rules.bestOf.maxRounds) ? Math.floor(rules.bestOf.maxRounds) : 0;
      if (maxRounds < 1 || maxRounds > 10) return '最多轮次需要在 1-10 之间。';
    }
    return null;
  }, [rules.participants, rules.cardsPerPlayer, rules.dealPerPlayer, rules.dealWhenEmpty, rules.bestOf?.enabled, rules.bestOf?.maxRounds, rules.submissionMode]);

  const isRulesValid = !rulesError;

  const ensureScenarioSelectedIfNeeded = (): boolean => {
    if (rules.mode !== 'scenario') return true;
    if (!scenarioSelection) {
      setError('情景模式必须选择一个情景（可从在线情景库选择 / 随机匹配 / 使用预设情景）。');
      return false;
    }
    return true;
  };

  const handleSelectScenarioCard = async (cardData: any) => {
    const cleaned = removePrivateKeys(cardData);
    const sourceInfo = mapDataCardRuntimeSourceInfo(cardData);
    const template = inferTemplate(cleaned);
    if (template !== 'scenario' && template !== 'general-scenario') {
      setError('❌ 请选择“情景”类型的数据卡。');
      return;
    }
    const cardId = sourceInfo.sourceDataCardId ?? '';
    if (!cardId) {
      setError('❌ PVP 情景仅允许使用在线数据库中的情景数据卡。');
      return;
    }
    const fallbackName = typeof cleaned?.title === 'string' ? cleaned.title.trim() : '';
    const name = sourceInfo.sourceDataCardName ?? fallbackName;
    setScenarioSelection({
      kind: 'data_card',
      id: cardId,
      updatedAt: sourceInfo.sourceDataCardUpdatedAt ?? null,
      name: name || null,
      isPublic: typeof sourceInfo.sourceIsPublic === 'boolean' ? sourceInfo.sourceIsPublic : null,
      author: sourceInfo.sourceAuthor ?? null,
    } satisfies PvpScenarioSelection);
    setError(null);
  };

  const handleRandomMatchScenario = async () => {
    setError(null);
    setIsScenarioMatching(true);
    setError('正在从数据库中随机寻找一份公开的情景...');
    try {
      const response = await fetch('/api/random-public-card?type=scenario');
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机情景');
      }
      const payload = mapPublicDataCardRowToBattleSelectionPayload(result.card);
      await handleSelectScenarioCard(payload);
    } catch (e) {
      setError(`❌ 随机匹配失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setIsScenarioMatching(false);
    }
  };

  const selectedPresetScenarioFilenames =
    scenarioSelection?.kind === 'preset' ? [scenarioSelection.filename] : [];

  const handleTogglePresetScenario = (preset: ScenarioPreset) => {
    if (isCreating) return;
    setScenarioSelection((prev) => {
      if (prev?.kind === 'preset' && prev.filename === preset.filename) return null;
      return {
        kind: 'preset',
        filename: preset.filename,
        name: preset.title,
      } satisfies PvpScenarioSelection;
    });
    setError(null);
  };

  const handleCreateRoom = async () => {
    setError(null);
    if (!isAuthenticated) {
      setError('请先登录后再创建房间。');
      return;
    }
    if (!ensureScenarioSelectedIfNeeded()) return;
    if (!isRulesValid) {
      setError(`规则不合法：${rulesError || '请检查输入。'}`);
      return;
    }

    setIsCreating(true);
    try {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');

      const res = await fetch('/api/pvp/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          rules,
          password: createPassword.trim() || undefined,
          ...(rules.mode === 'scenario' && scenarioSelection ? { scenario: scenarioSelection } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '创建房间失败');

      const roomId = data.roomId as string;
      if (createPassword.trim()) saveRoomPassword(roomId, createPassword);
      await router.push(`/pvp/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建房间失败');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    setError(null);
    const roomId = extractRoomIdFromInput(joinRoomId);
    if (!roomId) {
      setError('请输入房间ID。');
      return;
    }
    if (joinPassword.trim()) saveRoomPassword(roomId, joinPassword);
    await router.push(`/pvp/${roomId}`);
  };

  const handleQuickMatch = async () => {
    setError(null);
    if (!isAuthenticated) {
      setError('请先登录后再快速匹配。');
      return;
    }

    setIsQuickMatching(true);
    try {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');

      const res = await fetch('/api/pvp/rooms/quick-match', {
        method: 'POST',
        headers: { Authorization: authHeader },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '快速匹配失败');

      const roomId = typeof data.roomId === 'string' ? data.roomId : '';
      if (!roomId) throw new Error('快速匹配失败：缺少 roomId');
      await router.push(`/pvp/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '快速匹配失败');
    } finally {
      setIsQuickMatching(false);
    }
  };

  return (
    <>
      <Head>
        <title>PVP 对战大厅 - MahoShojo Generator</title>
        <meta name="description" content="创建或加入PVP房间，进行卡组对战！" />
      </Head>

      <div className="magic-background-white">
        <div className="container !max-w-[980px]">
          <div className="card !max-w-none !p-0">
            <PvpHeroBanner
              title="PVP 对战大厅"
              subtitle="房间制 + 同时出牌 + 战报结算（2-6 人同局）。粘贴房间链接也可自动识别 ID。"
              right={
                <button onClick={() => window.location.assign('/')} className="text-sm text-blue-700 hover:underline">
                  返回首页
                </button>
              }
            />

            <div className="p-6">
              {!loading && !isAuthenticated && (
                <div className="p-3 rounded-md bg-yellow-100 text-yellow-800 text-sm mb-4">
                  未登录状态下无法创建/加入房间。请先在其他页面完成登录。
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white border text-sm">
                  <h2 className="font-semibold mb-2 text-gray-900">创建房间</h2>
                  <div className="text-xs text-gray-600 mb-3">
                    提示：支持“每人提交（固定数量）”与“仅房主提交牌堆（任意数量）”。若卡牌不足，会按“未发放的提交卡 → 已使用卡（可选）→ 抽取来源”补足；每人提交=0 时跳过提交阶段，开局按“手牌为空时补发”发牌。
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-gray-800">人数（2-6）</span>
                      <input
                        className="border rounded px-2 py-1"
                        type="number"
                        min={2}
                        max={6}
                        value={rules.participants}
                        onChange={(e) => updateRules({ participants: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-gray-800">卡组提交模式</span>
                      <select
                        className="border rounded px-2 py-1"
                        value={rules.submissionMode}
                        onChange={(e) => {
                          const next = e.target.value === 'hostOnly' ? 'hostOnly' : 'perPlayer';
                          updateRules(next === 'hostOnly'
                            ? { submissionMode: 'hostOnly', cardsPerPlayer: 0, shuffleDecks: true }
                            : { submissionMode: 'perPlayer' }
                          );
                        }}
                      >
                        <option value="perPlayer">每人提交（固定数量）</option>
                        <option value="hostOnly">仅房主提交牌堆（任意数量）</option>
                      </select>
                      {rules.submissionMode === 'hostOnly' ? (
                        <div className="text-xs text-gray-500">该模式下仅房主提交卡牌，提交内容作为公共牌堆供所有玩家抽取。</div>
                      ) : (
                        <div className="text-xs text-gray-500">每位玩家都需要提交固定张数；提交阶段会隐藏他人详情，避免被针对。</div>
                      )}
                    </label>
                    {rules.submissionMode !== 'hostOnly' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-gray-800">每人提交</span>
                        <input
                          className="border rounded px-2 py-1"
                          type="number"
                          min={0}
                          max={50}
                          value={rules.cardsPerPlayer}
                          onChange={(e) => updateRules({ cardsPerPlayer: Number(e.target.value) })}
                        />
                      </label>
                    )}
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-800">初始手牌</span>
                      <input
                        className="border rounded px-2 py-1"
                        type="number"
                        min={1}
                        max={50}
                        value={rules.dealPerPlayer}
                        onChange={(e) => updateRules({ dealPerPlayer: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-800">手牌为空时补发</span>
                      <input
                        className="border rounded px-2 py-1"
                        type="number"
                        min={1}
                        max={50}
                        value={rules.dealWhenEmpty}
                        onChange={(e) => updateRules({ dealWhenEmpty: Number(e.target.value) })}
                      />
                    </label>
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-gray-800">抽取来源（提交牌池用尽后）</span>
                      <select
                        className="border rounded px-2 py-1"
                        value={rules.drawSource ?? 'public'}
                        onChange={(e) => updateRules({ drawSource: e.target.value as 'public' | 'preset' | 'preset+public' })}
                      >
                        <option value="public">公开库（默认）</option>
                        <option value="preset">预设</option>
                        <option value="preset+public">预设 + 公开库</option>
                      </select>
                      <div className="text-xs text-gray-500">
                        {rules.submissionMode === 'hostOnly'
                          ? '仅房主提交牌堆时：房主提交内容会作为公共牌堆供所有参与者抽取。'
                          : '每人提交=0 时：开局直接按“手牌为空时补发”发牌。'}
                      </div>
                    </label>
                    <label className="flex items-center gap-2 col-span-1 text-gray-800">
                      <input
                        type="checkbox"
                        checked={rules.recycleUsedCards === true}
                        onChange={(e) => updateRules({ recycleUsedCards: e.target.checked })}
                      />
                      <span>允许重复发放已使用的卡</span>
                    </label>
                    <label className="flex items-center gap-2 col-span-2 text-gray-800">
                      <input
                        type="checkbox"
                        checked={rules.dedupe}
                        onChange={(e) => updateRules({ dedupe: e.target.checked })}
                      />
                      <span>去重（建议开启）</span>
                    </label>
                    <label className="flex items-center gap-2 col-span-2 text-gray-800">
                      <input
                        type="checkbox"
                        checked={rules.showAllSubmissions}
                        onChange={(e) => updateRules({ showAllSubmissions: e.target.checked })}
                      />
                      <span>显示所有人提交的卡组（默认开启）</span>
                    </label>
                    <label className="flex items-center gap-2 col-span-2 text-gray-800">
                      <input
                        type="checkbox"
                        checked={rules.shuffleDecks}
                        onChange={(e) => updateRules({ shuffleDecks: e.target.checked })}
                        disabled={rules.submissionMode === 'hostOnly'}
                      />
                      <span>洗混卡组后发牌（默认开启）{rules.submissionMode === 'hostOnly' ? '（房主牌堆模式下固定开启）' : ''}</span>
                    </label>
                    <div className="col-span-2">
                      <BattleModeSelector value={rules.mode} onChange={(next) => updateRules({ mode: next })} />
                    </div>
                    <div className="col-span-2 mt-1">
                      <GenerationModeSwitcher
                        label="战报生成方式"
                        value={rules.generationMode === 'stream' ? 'stream' : 'non-stream'}
                        disabled={isCreating}
                        onChange={(mode) => updateRules({ generationMode: mode })}
                      />
                    </div>
                    {rules.mode === 'scenario' && (
                      <div className="col-span-2 border rounded-lg p-3 bg-white">
                        <ScenarioPickerPanel
                          onOpenScenarioModal={() => setShowScenarioModal(true)}
                          onRandomMatchScenario={handleRandomMatchScenario}
                          enableLocalInput={false}
                          onActionError={(e) => setError(`❌ ${e.message}`)}
                          isAuthenticated={isAuthenticated}
                          isGenerating={isCreating}
                          isMatchingBlocked={isScenarioMatching}
                          isMatchingScenario={isScenarioMatching}
                          scenarioFileName={scenarioSelection?.name ?? null}
                        />

                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setPresetScenarioCollapsed((prev) => !prev)}
                            className="text-purple-700 hover:underline cursor-pointer font-semibold"
                            disabled={isCreating}
                          >
                            {presetScenarioCollapsed ? '▶ 展开预设情景（内置）' : '▼ 折叠预设情景（内置）'}
                          </button>

                          {!presetScenarioCollapsed && (
                            <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                              {scenarioPresetQuery.error ? (
                                <div className="text-sm text-red-600">
                                  无法加载预设情景：{(scenarioPresetQuery.error as Error).message}
                                </div>
                              ) : scenarioPresetQuery.isLoading || !scenarioPresetQuery.data ? (
                                <div className="text-sm text-gray-500">正在加载预设情景...</div>
                              ) : (
                                <ScenarioPresetGridPicker
                                  title="选择预设情景"
                                  presets={scenarioPresetQuery.data}
                                  currentPage={presetScenarioPage}
                                  onPageChange={setPresetScenarioPage}
                                  disabled={isCreating}
                                  selectedFilenames={selectedPresetScenarioFilenames}
                                  onToggle={handleTogglePresetScenario}
                                />
                              )}
                              <div className="text-xs text-gray-500">
                                提示：PVP 房间情景对所有回合生效；更换情景会影响后续结算叙事。
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="col-span-2 border rounded-lg p-3 bg-gray-50">
                      <label className="flex items-center gap-2 text-gray-800">
                        <input
                          type="checkbox"
                          checked={rules.bestOf.enabled}
                          onChange={(e) =>
                            setRules({
                              ...rules,
                              bestOf: { ...rules.bestOf, enabled: e.target.checked },
                            } satisfies PvpRoomRules)
                          }
                        />
                        <span>启用多局制（按轮次累计胜场）</span>
                      </label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-gray-800">最多轮次</span>
                          <input
                            className="border rounded px-2 py-1"
                            type="number"
                            min={1}
                            max={10}
                            value={rules.bestOf.maxRounds}
                            disabled={!rules.bestOf.enabled}
                            onChange={(e) =>
                              setRules({
                                ...rules,
                                bestOf: { ...rules.bestOf, maxRounds: Number(e.target.value) },
                              } satisfies PvpRoomRules)
                            }
                          />
                        </label>
                        <div className="text-xs text-gray-600 flex items-end pb-1">
                          {rules.bestOf.enabled ? '提示：多局制下若手牌为空，会按设置自动补牌' : '关闭时为单局对战'}
                        </div>
                      </div>
                    </div>
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-gray-800">房间口令（可选）</span>
                      <input
                        className="border rounded px-2 py-1"
                        value={createPassword}
                        onChange={(e) => setCreatePassword(e.target.value)}
                        placeholder="留空表示无口令"
                      />
                    </label>
                  </div>

                  <button
                    onClick={handleCreateRoom}
                    disabled={!isAuthenticated || isCreating || !isRulesValid || (rules.mode === 'scenario' && !scenarioSelection)}
                    className="generate-button mt-3 w-full"
                    style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                  >
                    {isCreating ? '创建中…' : '创建房间'}
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-white border text-sm">
                  <h2 className="font-semibold mb-2 text-gray-900">加入房间</h2>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <button
                      onClick={() => setShowRoomBrowserModal(true)}
                      disabled={!isAuthenticated}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg border border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 hover:border-purple-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      title="浏览可加入的房间（搜索/筛选/加入）"
                    >
                      <LayoutList className="w-4 h-4" />
                      房间浏览器
                    </button>
                    <button
                      onClick={() => void handleQuickMatch()}
                      disabled={!isAuthenticated || isQuickMatching}
                      className="generate-button"
                      style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                    >
                      {isQuickMatching ? '匹配中…' : '快速匹配'}
                    </button>
                  </div>
                  <label className="flex flex-col gap-1 mb-2">
                    <span className="text-gray-800">房间ID / 链接</span>
                    <input
                      className="border rounded px-2 py-1"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(extractRoomIdFromInput(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleJoin();
                      }}
                      placeholder="例如：a1b2c3… 或 https://.../pvp/a1b2c3"
                      inputMode="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="flex flex-col gap-1 mb-3">
                    <span className="text-gray-800">房间口令（若房主设置）</span>
                    <input
                      className="border rounded px-2 py-1"
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleJoin();
                      }}
                    />
                  </label>
                  <button
                    onClick={handleJoin}
                    disabled={!isAuthenticated}
                    className="generate-button w-full"
                    style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                  >
                    进入房间
                  </button>
                  <div className="text-xs text-gray-500 mt-2">
                    提示：口令会缓存到本次浏览器会话，方便重连。
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-md bg-red-100 text-red-800 text-sm mt-4 whitespace-pre-wrap">
                  {error}
                </div>
              )}
            </div>
          </div>

          <Footer />
        </div>
      </div>

      {showScenarioModal && (
        <BattleDataModal
          isOpen={showScenarioModal}
          onClose={() => setShowScenarioModal(false)}
          onSelectCard={(card) => void handleSelectScenarioCard(card)}
          selectedType="scenario"
          titleOverride="选择情景"
        />
      )}

      {showRoomBrowserModal && (
        <PvpRoomBrowserModal
          isOpen={showRoomBrowserModal}
          onClose={() => setShowRoomBrowserModal(false)}
        />
      )}
    </>
  );
}
