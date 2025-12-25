'use client';

import { useQuery } from '@tanstack/react-query';

import { BaseModal } from '@/components/shared/BaseModal';
import { authStorage } from '@/lib/auth';

type CombatantItem = {
  sortIndex: number;
  name: string;
  type: string | null;
  templateId: string | null;
  isNative: boolean;
  isPreset: boolean;
  teamId: number | null;
  dataCardId: string | null;
  dataCardUpdatedAt: string | null;
};

type DetailResponse = {
  success: true;
  record: {
    id: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    status: string;
    endpoint: string;
    generationMode: string;
    mode: string;
    scenarioTitle: string | null;
    language: string | null;
    selectedLevel: string | null;
    storyLength: string | null;
    headline: string | null;
    winner: string | null;
    outputPreview: string | null;
    hasPreview: boolean;
    contentBlocked: boolean;
    outputHasShieldWords: boolean;
    pvpRoomId: string | null;
    pvpMatchId: string | null;
    pvpRoundId: string | null;
  };
  combatants: CombatantItem[];
};

type Props = {
  isOpen: boolean;
  generationId: string | null;
  onClose: () => void;
  onRegenerate: (generationId: string) => void;
  isRegenerating?: boolean;
  regenerateError?: string | null;
};

const formatTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString();
};

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms)) return '未知';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${min}m ${rest}s`;
};

export function BattleReportDetailsModal({ isOpen, generationId, onClose, onRegenerate, isRegenerating, regenerateError }: Props) {
  const detailQuery = useQuery({
    queryKey: ['me', 'battle-reports', 'detail', generationId],
    enabled: Boolean(isOpen && generationId),
    queryFn: async (): Promise<DetailResponse> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/me/battle-reports/${generationId}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载战报详情失败');
      return data as DetailResponse;
    },
  });

  const record = detailQuery.data?.record ?? null;
  const combatants = detailQuery.data?.combatants ?? [];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={record?.headline || '战报详情'}
      description={record ? `generationId：${record.id}` : undefined}
      maxWidthClassName="max-w-5xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {record?.contentBlocked ? '该记录包含敏感词，已禁止展示正文预览。' : '提示：详情仅用于回溯；建议及时下载战报卡片/Markdown。'}
          </div>
          <div className="flex items-center gap-2">
            {generationId ? (
              <button
                type="button"
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                onClick={() => onRegenerate(generationId)}
                disabled={Boolean(isRegenerating)}
              >
                {isRegenerating ? '生成中…' : '重生战报卡片'}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      }
    >
      {detailQuery.isLoading ? <div className="text-sm text-gray-600">加载中…</div> : null}
      {detailQuery.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          加载失败：{(detailQuery.error as Error).message}
        </div>
      ) : null}

      {record ? (
        <div className="space-y-4">
          {regenerateError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              重新生成失败：{regenerateError}
            </div>
          ) : null}
          <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
            <div className="text-sm">
              <div className="text-xs text-gray-500">状态</div>
              <div className="font-medium text-gray-900">
                {record.mode} / {record.status}（{record.generationMode}）
              </div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">胜者</div>
              <div className="font-medium text-gray-900">{record.winner || '（未知）'}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">开始时间</div>
              <div className="font-medium text-gray-900">{formatTime(record.startedAt)}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">耗时</div>
              <div className="font-medium text-gray-900">{formatDuration(record.durationMs)}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">来源</div>
              <div className="font-medium text-gray-900 break-all">{record.endpoint}</div>
            </div>
            <div className="text-sm">
              <div className="text-xs text-gray-500">PVP 关联</div>
              <div className="font-medium text-gray-900 break-all">
                {record.pvpMatchId ? `match=${record.pvpMatchId}` : '无'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-gray-900">参战者</div>
              <div className="text-xs text-gray-500">{combatants.length} 位</div>
            </div>
            {combatants.length <= 0 ? (
              <div className="mt-2 text-sm text-gray-600">无参战者明细（可能写入失败或已清理）。</div>
            ) : (
              <div className="mt-2 overflow-hidden rounded-lg border">
                <div className="grid grid-cols-12 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                  <div className="col-span-5">名称</div>
                  <div className="col-span-3">类型</div>
                  <div className="col-span-4">来源</div>
                </div>
                <div className="divide-y">
                  {combatants.map((c) => (
                    <div key={`${c.sortIndex}:${c.name}`} className="grid grid-cols-12 px-3 py-2 text-sm">
                      <div className="col-span-5 truncate font-medium text-gray-900">{c.name}</div>
                      <div className="col-span-3 truncate text-gray-700">{c.type || '未知'}</div>
                      <div className="col-span-4 truncate text-gray-600">
                        {c.dataCardId ? `数据卡 ${c.dataCardId}` : c.isPreset ? '预设角色' : c.isNative ? '本地原生' : '未知'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-gray-900">正文预览</div>
              {record.contentBlocked ? (
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
                  已屏蔽
                </span>
              ) : record.outputHasShieldWords ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                  含屏蔽词
                </span>
              ) : null}
            </div>

            {record.contentBlocked ? (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                该记录包含敏感词，已禁止浏览内容。
              </div>
            ) : record.outputPreview ? (
              <pre className="mt-2 whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">
                {record.outputPreview}
              </pre>
            ) : (
              <div className="mt-2 text-sm text-gray-600">暂无可用预览（可能生成失败/已清理/未写入预览）。</div>
            )}
          </div>
        </div>
      ) : null}
    </BaseModal>
  );
}
