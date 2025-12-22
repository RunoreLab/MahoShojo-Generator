'use client';

import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import Footer from '@/components/Footer';
import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import { DEFAULT_PVP_RULES } from '@/lib/pvp/defaults';
import type { PvpRoomRules } from '@/lib/pvp/types';

const PASSWORD_CACHE_PREFIX = 'pvp-room-password:';

const saveRoomPassword = (roomId: string, password: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = password.trim();
  if (!trimmed) return;
  sessionStorage.setItem(`${PASSWORD_CACHE_PREFIX}${roomId}`, trimmed);
};

export function PvpLobbyPage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();

  const [rules, setRules] = useState<PvpRoomRules>(DEFAULT_PVP_RULES);
  const [createPassword, setCreatePassword] = useState('');
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

  const handleCreateRoom = async () => {
    setError(null);
    if (!isAuthenticated) {
      setError('请先登录后再创建房间。');
      return;
    }
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
        body: JSON.stringify({ rules, password: createPassword.trim() || undefined }),
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
    const roomId = joinRoomId.trim();
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
        <div className="container">
          <div className="card" style={{ border: '2px solid #ccc', background: '#f9f9f9' }}>
            <h1 className="text-xl font-bold mb-2">PVP 对战大厅</h1>
            <p className="text-sm text-gray-700 mb-4">
              目前支持：房间制 + 轮询 + 同时出牌 + 战报结算（2-6 人同局）。
            </p>

            {!loading && !isAuthenticated && (
              <div className="p-3 rounded-md bg-yellow-100 text-yellow-800 text-sm mb-4">
                未登录状态下无法创建/加入房间。请先在其他页面完成登录。
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 rounded-md bg-white border">
                <h2 className="font-semibold mb-2">创建房间</h2>
                <div className="text-sm text-gray-700 mb-2">
                  建议：提交数 &gt; 发牌数（否则可推导对手手牌）。
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex flex-col gap-1 col-span-2">
                    <span>人数（2-6）</span>
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
                    <span>每人提交</span>
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
                    <span>每人发牌</span>
                    <input
                      className="border rounded px-2 py-1"
                      type="number"
                      min={1}
                      max={10}
                      value={rules.dealPerPlayer}
                      onChange={(e) => setRules((r) => ({ ...r, dealPerPlayer: Number(e.target.value) }))}
                    />
                  </label>
                  <label className="flex items-center gap-2 col-span-2">
                    <input
                      type="checkbox"
                      checked={rules.dedupe}
                      onChange={(e) => setRules((r) => ({ ...r, dedupe: e.target.checked }))}
                    />
                    <span>去重（建议开启）</span>
                  </label>
                  <label className="flex flex-col gap-1 col-span-2">
                    <span>模式</span>
                    <select
                      className="border rounded px-2 py-1"
                      value={rules.mode}
                      onChange={(e) => setRules((r) => ({ ...r, mode: e.target.value as any }))}
                    >
                      <option value="classic">classic</option>
                      <option value="kizuna">kizuna</option>
                      <option value="scenario">scenario</option>
                    </select>
                  </label>
                  <div className="col-span-2 border rounded p-2 bg-gray-50">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rules.bestOf.enabled}
                        onChange={(e) => setRules((r) => ({ ...r, bestOf: { ...r.bestOf, enabled: e.target.checked } }))}
                      />
                      <span>启用多局制（按轮次累计胜场）</span>
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span>最多轮次</span>
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
                    <span>房间口令（可选）</span>
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
                  disabled={!isAuthenticated || isCreating || !isRulesValid}
                  className="generate-button mt-3 w-full"
                  style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                >
                  {isCreating ? '创建中…' : '创建房间'}
                </button>
              </div>

              <div className="p-3 rounded-md bg-white border">
                <h2 className="font-semibold mb-2">加入房间</h2>
                <label className="flex flex-col gap-1 text-sm mb-2">
                  <span>房间ID</span>
                  <input className="border rounded px-2 py-1" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-sm mb-2">
                  <span>房间口令（若房主设置）</span>
                  <input className="border rounded px-2 py-1" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} />
                </label>
                <button
                  onClick={handleJoin}
                  disabled={!isAuthenticated}
                  className="generate-button w-full"
                  style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                >
                  进入房间
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-md bg-red-100 text-red-800 text-sm mt-4 whitespace-pre-wrap">
                {error}
              </div>
            )}

            <div className="text-center mt-6">
              <button onClick={() => window.location.assign('/')} className="footer-link">
                返回首页
              </button>
            </div>
          </div>

          <Footer />
        </div>
      </div>
    </>
  );
}
