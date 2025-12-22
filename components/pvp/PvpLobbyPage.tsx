'use client';

import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import BattleDataModal from '@/components/BattleDataModal';
import Footer from '@/components/Footer';
import { PvpHeroBanner } from '@/components/pvp/PvpHeroBanner';
import { BattleModeSelector } from '@/components/shared/BattleModeSelector';
import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';
import { authStorage } from '@/lib/auth';
import { inferTemplate } from '@/lib/data-card-converter';
import { useAuth } from '@/lib/useAuth';
import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import type { PvpRoomRules, PvpScenarioSelection } from '@/lib/pvp/types';

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

const verifyOrigin = async (payload: any): Promise<boolean> => {
  const response = await fetch('/api/verify-origin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return false;
  const { isValid } = await response.json();
  return Boolean(isValid);
};

export function PvpLobbyPage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  const [rules, setRules] = useState<PvpRoomRules>(DEFAULT_PVP_RULES);
  const [createPassword, setCreatePassword] = useState('');
  const [scenarioSelection, setScenarioSelection] = useState<PvpScenarioSelection | null>(null);
  const [isScenarioMatching, setIsScenarioMatching] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const isRulesValid = useMemo(() => {
    const baseValid = rules.participants >= 2 && rules.participants <= 6 && rules.cardsPerPlayer > rules.dealPerPlayer;
    if (!baseValid) return false;
    if (rules.bestOf?.enabled) return rules.dealPerPlayer >= rules.bestOf.maxRounds;
    return true;
  }, [rules.participants, rules.cardsPerPlayer, rules.dealPerPlayer, rules.bestOf?.enabled, rules.bestOf?.maxRounds]);

  const ensureScenarioSelectedIfNeeded = (): boolean => {
    if (rules.mode !== 'scenario') return true;
    if (!scenarioSelection) {
      setError('情景模式必须选择一个情景（可从在线情景库选择 / 随机匹配 / 上传 / 粘贴）。');
      return false;
    }
    return true;
  };

  const handleSelectScenarioCard = async (cardData: any) => {
    const cleaned = removePrivateKeys(cardData);
    if (inferTemplate(cleaned) !== 'scenario') {
      setError('❌ 请选择“情景”类型的数据卡。');
      return;
    }
    const isNative = await verifyOrigin(cleaned);
    const fileBase = typeof cardData?._cardName === 'string' ? cardData._cardName : (typeof cleaned?.title === 'string' ? cleaned.title : '情景');
    const fileName = `${String(fileBase).trim() || '情景'}.json`;
    setScenarioSelection({
      content: cleaned,
      fileName,
      isNative,
      sourceDataCardId: typeof cardData?._cardId === 'string' ? cardData._cardId : undefined,
      sourceDataCardUpdatedAt: typeof cardData?._updatedAt === 'string' ? cardData._updatedAt : undefined,
      sourceDataCardName: typeof cardData?._cardName === 'string' ? cardData._cardName : undefined,
      sourceIsPublic: typeof cardData?._isPublic === 'boolean'
        ? cardData._isPublic
        : (typeof cardData?._isPublic === 'number' ? cardData._isPublic === 1 : undefined),
      sourceAuthor: typeof cardData?._author === 'string' ? cardData._author : undefined,
    });
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
      const cardData = JSON.parse(result.card.data);
      await handleSelectScenarioCard({
        ...cardData,
        _cardId: result.card.id,
        _cardName: result.card.name,
        _isPublic: result.card.is_public,
        _updatedAt: result.card.updated_at,
        _createdAt: result.card.created_at,
        _author: result.card.username || '未知',
      });
    } catch (e) {
      setError(`❌ 随机匹配失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setIsScenarioMatching(false);
    }
  };

  const handleScenarioUpload = async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('情景文件内容必须是一个 JSON 对象');
    }
    if (typeof (json as any).title !== 'string' || !(json as any).title.trim()) {
      throw new Error('情景文件缺少 title');
    }
    const isNative = await verifyOrigin(json);
    setScenarioSelection({ content: json as any, fileName: file.name, isNative });
    setError(null);
  };

  const handleScenarioPaste = async (text: string) => {
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('情景文本必须是一个 JSON 对象');
    }
    const title = typeof (json as any).title === 'string' ? (json as any).title.trim() : '';
    if (!title) throw new Error('情景文本缺少 title');
    const isNative = await verifyOrigin(json);
    setScenarioSelection({ content: json as any, fileName: `${title}.json`, isNative });
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
      if (rules.cardsPerPlayer <= rules.dealPerPlayer) {
        setError('规则不合法：cardsPerPlayer 必须 > dealPerPlayer（保证对手手牌不可被直接推出）。');
        return;
      }
      if (rules.bestOf?.enabled && rules.dealPerPlayer < rules.bestOf.maxRounds) {
        setError('规则不合法：启用多局制时，dealPerPlayer 必须 >= maxRounds（保证必定结束）。');
        return;
      }
      setError('规则不合法，请检查输入。');
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
                    建议：提交数 &gt; 发牌数（否则可推导对手手牌）。
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
                        onChange={(e) => setRules((r) => ({ ...r, participants: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-800">每人提交</span>
                      <input
                        className="border rounded px-2 py-1"
                        type="number"
                        min={1}
                        max={10}
                        value={rules.cardsPerPlayer}
                        onChange={(e) => setRules((r) => ({ ...r, cardsPerPlayer: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-gray-800">每人发牌</span>
                      <input
                        className="border rounded px-2 py-1"
                        type="number"
                        min={1}
                        max={10}
                        value={rules.dealPerPlayer}
                        onChange={(e) => setRules((r) => ({ ...r, dealPerPlayer: Number(e.target.value) }))}
                      />
                    </label>
                    <label className="flex items-center gap-2 col-span-2 text-gray-800">
                      <input
                        type="checkbox"
                        checked={rules.dedupe}
                        onChange={(e) => setRules((r) => ({ ...r, dedupe: e.target.checked }))}
                      />
                      <span>去重（建议开启）</span>
                    </label>
                    <div className="col-span-2">
                      <BattleModeSelector value={rules.mode} onChange={(next) => setRules((r) => ({ ...r, mode: next }))} />
                    </div>
                    {rules.mode === 'scenario' && (
                      <div className="col-span-2 border rounded-lg p-3 bg-white">
                        <ScenarioPickerPanel
                          onOpenScenarioModal={() => setShowScenarioModal(true)}
                          onRandomMatchScenario={handleRandomMatchScenario}
                          onScenarioUpload={handleScenarioUpload}
                          onScenarioPaste={handleScenarioPaste}
                          onActionError={(e) => setError(`❌ ${e.message}`)}
                          isAuthenticated={isAuthenticated}
                          isGenerating={isCreating}
                          isMatchingBlocked={isScenarioMatching}
                          isMatchingScenario={isScenarioMatching}
                          scenarioFileName={scenarioSelection?.fileName ?? null}
                          isScenarioNative={scenarioSelection?.isNative === true}
                        />
                      </div>
                    )}
                    <div className="col-span-2 border rounded-lg p-3 bg-gray-50">
                      <label className="flex items-center gap-2 text-gray-800">
                        <input
                          type="checkbox"
                          checked={rules.bestOf.enabled}
                          onChange={(e) => setRules((r) => ({ ...r, bestOf: { ...r.bestOf, enabled: e.target.checked } }))}
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
                              setRules((r) => ({ ...r, bestOf: { ...r.bestOf, maxRounds: Number(e.target.value) } }))
                            }
                          />
                        </label>
                        <div className="text-xs text-gray-600 flex items-end pb-1">
                          {rules.bestOf.enabled ? '提示：每人发牌需 ≥ 轮次（否则无法保证结束）' : '关闭时为单局对战'}
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
    </>
  );
}
