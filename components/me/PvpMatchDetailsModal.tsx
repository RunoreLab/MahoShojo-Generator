'use client';

import { useQuery } from '@tanstack/react-query';

import { BaseModal } from '@/components/shared/BaseModal';
import { authStorage } from '@/lib/auth';

type PlayerItem = {
  userId: number;
  seat: number;
  username: string | null;
  prefix: string | null;
  joinedAt: string;
};

type RoundItem = {
  id: string;
  roomId: string;
  roundIndex: number;
  status: string;
  winnerUserId: number | null;
  winnerName: string | null;
  battleGenerationId: string | null;
  createdAt: string;
};

type MatchDetailResponse = {
  success: true;
  match: {
    id: string;
    roomId: string;
    status: string;
    participants: number;
    startedAt: string;
    endedAt: string | null;
    winnerUserId: number | null;
  };
  players: PlayerItem[];
  rounds: RoundItem[];
};

type Props = {
  isOpen: boolean;
  matchId: string | null;
  myUserId: number | null;
  onClose: () => void;
  onOpenBattleReport: (generationId: string) => void;
};

const formatUserLabel = (p: { userId: number; username: string | null; prefix: string | null }) => {
  const prefix = p.prefix ? `${p.prefix} ` : '';
  const username = p.username ? p.username : `用户${p.userId}`;
  return `${prefix}${username}`;
};

const formatTime = (iso: string | null): string => {
  if (!iso) return '暂无';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso);
  return new Date(ms).toLocaleString();
};

export function PvpMatchDetailsModal({ isOpen, matchId, myUserId, onClose, onOpenBattleReport }: Props) {
  const detailQuery = useQuery({
    queryKey: ['me', 'pvp', 'match-detail', matchId],
    enabled: Boolean(isOpen && matchId),
    queryFn: async (): Promise<MatchDetailResponse> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/me/pvp/matches/${matchId}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载对局详情失败');
      return data as MatchDetailResponse;
    },
  });

  const match = detailQuery.data?.match ?? null;
  const players = detailQuery.data?.players ?? [];
  const rounds = detailQuery.data?.rounds ?? [];
  const mySeat = myUserId ? players.find((p) => p.userId === myUserId)?.seat ?? null : null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={match ? `对局详情（${match.id}）` : '对局详情'}
      description={match ? `room：${match.roomId}` : undefined}
      maxWidthClassName="max-w-5xl"
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      }
    >
      {detailQuery.isLoading ? <div className="text-sm text-gray-600">加载中…</div> : null}
      {detailQuery.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          加载失败：{(detailQuery.error as Error).message}
        </div>
      ) : null}

      {match ? (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
            <div className="text-sm">
              <div className="text-xs text-gray-500">状态</div>
              <div className="font-medium text-gray-900">{match.status}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">我的座位</div>
              <div className="font-medium text-gray-900">{mySeat ?? '？'}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">开始时间</div>
              <div className="font-medium text-gray-900">{formatTime(match.startedAt)}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">结束时间</div>
              <div className="font-medium text-gray-900">{formatTime(match.endedAt)}</div>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-gray-900">参与者</div>
              <div className="text-xs text-gray-500">{players.length} 人</div>
            </div>
            {players.length <= 0 ? (
              <div className="mt-2 text-sm text-gray-600">暂无参与者快照。</div>
            ) : (
              <div className="mt-2 space-y-2">
                {players.map((p) => (
                  <div
                    key={`${p.userId}:${p.seat}`}
                    className={[
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-sm',
                      myUserId && p.userId === myUserId ? 'border-gray-900 bg-gray-50' : 'bg-white',
                    ].join(' ')}
                  >
                    <div className="font-medium text-gray-900">{formatUserLabel(p)}</div>
                    <div className="text-xs text-gray-600">seat {p.seat}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-gray-900">回合</div>
              <div className="text-xs text-gray-500">{rounds.length} 回合</div>
            </div>

            {rounds.length <= 0 ? (
              <div className="mt-2 text-sm text-gray-600">暂无回合记录。</div>
            ) : (
              <div className="mt-2 overflow-hidden rounded-lg border">
                <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                  <div className="col-span-2">回合</div>
                  <div className="col-span-3">状态</div>
                  <div className="col-span-4">胜者</div>
                  <div className="col-span-3 text-right">操作</div>
                </div>
                <div className="divide-y">
                  {rounds.map((r) => (
                    <div key={r.id} className="grid grid-cols-12 px-3 py-2 text-sm">
                      <div className="col-span-2 font-medium text-gray-900">#{r.roundIndex + 1}</div>
                      <div className="col-span-3 text-gray-700">{r.status}</div>
                      <div className="col-span-4 truncate text-gray-700">{r.winnerName || '（未知/平局）'}</div>
                      <div className="col-span-3 flex justify-end gap-2">
                        {r.battleGenerationId ? (
                          <button
                            type="button"
                            className="rounded-lg border bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                            onClick={() => onOpenBattleReport(r.battleGenerationId!)}
                          >
                            查看战报
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">无战报</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </BaseModal>
  );
}
