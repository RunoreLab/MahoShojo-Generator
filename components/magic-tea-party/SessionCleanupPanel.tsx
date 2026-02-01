import { useCallback, useMemo, useState } from 'react';

import { ErrorMessage } from '@/components/ErrorMessage';
import { buildMagicTeaPartyCleanupPlan } from '@/lib/magic-tea-party/retention';
import type { MagicTeaPartyPreferences, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type MagicTeaPartySessionCleanupPanelProps = {
  preferences: MagicTeaPartyPreferences;
  activeSessionId: string | null;
  onPreferenceChange: (patch: Partial<MagicTeaPartyPreferences>) => void;
  onCleanupSessions: (sessionIds: string[]) => Promise<void>;
};

export function MagicTeaPartySessionCleanupPanel(props: MagicTeaPartySessionCleanupPanelProps) {
  const { preferences, activeSessionId, onPreferenceChange, onCleanupSessions } = props;
  const [collapsed, setCollapsed] = useState(true);
  const [preview, setPreview] = useState<MagicTeaPartySession[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ expired: number; overLimit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const retentionDays = preferences.sessionRetentionDays;
  const maxSessions = preferences.maxSessions;

  const previewLabel = useMemo(() => {
    if (!preview) return '尚未预览';
    if (preview.length === 0) return '当前无需清理';
    return `将清理 ${preview.length} 个会话`;
  }, [preview]);

  const handlePreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const plan = await buildMagicTeaPartyCleanupPlan({
        retentionDays,
        maxSessions,
        excludeSessionId: activeSessionId,
      });
      setPreview(plan.candidates);
      setPreviewMeta({ expired: plan.expired.length, overLimit: plan.overLimit.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法预览清理计划');
    } finally {
      setLoading(false);
    }
  }, [activeSessionId, maxSessions, retentionDays]);

  const handleCleanup = useCallback(async () => {
    let candidates = preview ?? [];
    let meta = previewMeta;
    if (!preview) {
      const plan = await buildMagicTeaPartyCleanupPlan({
        retentionDays,
        maxSessions,
        excludeSessionId: activeSessionId,
      });
      candidates = plan.candidates;
      meta = { expired: plan.expired.length, overLimit: plan.overLimit.length };
      setPreview(candidates);
      setPreviewMeta(meta);
    }
    if (candidates.length === 0) return;
    const confirmed = typeof window === 'undefined' ? true : window.confirm(`确定清理 ${candidates.length} 个会话吗？`);
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      await onCleanupSessions(candidates.map((item) => item.id));
      setPreview([]);
      setPreviewMeta(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理失败');
    } finally {
      setLoading(false);
    }
  }, [activeSessionId, maxSessions, onCleanupSessions, preview, previewMeta, retentionDays]);

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-800">会话清理</div>
        <button
          type="button"
          className="text-xs text-pink-700 hover:underline"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {collapsed ? (
        <div className="space-y-2 text-xs text-gray-500">
          <div>仅影响本地浏览器数据，可在导出后执行清理。</div>
          <div>
            保留 {retentionDays} 天 · 最多 {maxSessions} 个会话 · {previewLabel}
          </div>
          {previewMeta ? (
            <div>
              过期 {previewMeta.expired} · 超量 {previewMeta.overLimit}
            </div>
          ) : null}
          {loading ? <div className="text-xs text-gray-500">处理中…</div> : null}
          {error ? (
            <div className="text-xs text-red-600">{error}</div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="text-[11px] text-gray-500">仅影响本地浏览器数据，可在导出后执行清理。</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs font-semibold text-gray-600">保留天数</label>
              <input
                type="number"
                min={1}
                max={3650}
                className="input-field !h-8 !px-2 !py-1 text-xs"
                value={String(retentionDays)}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  const value = Number.isFinite(nextValue) ? Math.max(1, Math.min(3650, Math.floor(nextValue))) : retentionDays;
                  onPreferenceChange({ sessionRetentionDays: value });
                }}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-semibold text-gray-600">最多保留会话数</label>
              <input
                type="number"
                min={10}
                max={1000}
                className="input-field !h-8 !px-2 !py-1 text-xs"
                value={String(maxSessions)}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  const value = Number.isFinite(nextValue) ? Math.max(10, Math.min(1000, Math.floor(nextValue))) : maxSessions;
                  onPreferenceChange({ maxSessions: value });
                }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{previewLabel}</span>
              {previewMeta ? (
                <span>
                  过期 {previewMeta.expired} · 超量 {previewMeta.overLimit}
                </span>
              ) : null}
            </div>
          </div>

          {preview && preview.length > 0 ? (
            <div className="space-y-1 text-[11px] text-gray-600">
              {preview.slice(0, 5).map((session) => (
                <div key={session.id} className="truncate">
                  {session.title} · {new Date(session.updatedAt ?? session.createdAt).toLocaleString()}
                </div>
              ))}
              {preview.length > 5 ? <div>…还有 {preview.length - 5} 个会话</div> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handlePreview()}
              disabled={loading}
            >
              预览清理
            </button>
            <button
              type="button"
              className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleCleanup()}
              disabled={loading || (preview !== null && preview.length === 0)}
            >
              执行清理
            </button>
            {loading ? <span className="text-xs text-gray-500">处理中…</span> : null}
          </div>

          {error ? (
            <ErrorMessage
              message={error}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
