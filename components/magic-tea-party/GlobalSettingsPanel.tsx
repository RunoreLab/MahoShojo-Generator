'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ErrorMessage } from '@/components/ErrorMessage';
import {
  cleanupMagicTeaPartyTachieCache,
  cleanupMagicTeaPartyExpiredTachieCache,
  formatMagicTeaPartyBytes,
  getMagicTeaPartyCacheStats,
  parseMagicTeaPartyCacheLimitInput,
  resolveMagicTeaPartyCacheLimits,
} from '@/lib/magic-tea-party/cache';
import { clearMagicTeaPartyTachieCache } from '@/lib/magic-tea-party/storage';
import type { MagicTeaPartyPreferences, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

const MB = 1024 * 1024;

type MagicTeaPartyGlobalSettingsPanelProps = {
  preferences: MagicTeaPartyPreferences;
  activeSession: MagicTeaPartySession | null;
  onPreferenceChange: (patch: Partial<MagicTeaPartyPreferences>) => void;
  onSessionSettingChange: (patch: Partial<MagicTeaPartySession['settings']>) => void;
};

export function MagicTeaPartyGlobalSettingsPanel(props: MagicTeaPartyGlobalSettingsPanelProps) {
  const { preferences, activeSession, onPreferenceChange, onSessionSettingChange } = props;
  const limits = useMemo(() => resolveMagicTeaPartyCacheLimits(preferences), [preferences]);
  const [cacheStats, setCacheStats] = useState({ totalCount: 0, totalBytes: 0, unknownCount: 0, expiredCount: 0 });
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await getMagicTeaPartyCacheStats();
      setCacheStats(stats);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '读取缓存信息失败');
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const handleCleanup = async () => {
    setIsCleaning(true);
    setCacheError(null);
    try {
      const stats = await cleanupMagicTeaPartyTachieCache({ sessionId: activeSession?.id, limits });
      setCacheStats(stats);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '清理失败');
    } finally {
      setIsCleaning(false);
    }
  };

  const handleClearAll = async () => {
    setIsCleaning(true);
    setCacheError(null);
    try {
      await clearMagicTeaPartyTachieCache();
      setCacheStats({ totalCount: 0, totalBytes: 0, unknownCount: 0, expiredCount: 0 });
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '清空失败');
    } finally {
      setIsCleaning(false);
    }
  };

  const handleCleanupExpired = async () => {
    setIsCleaning(true);
    setCacheError(null);
    try {
      const stats = await cleanupMagicTeaPartyExpiredTachieCache();
      setCacheStats(stats);
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : '清理过期缓存失败');
    } finally {
      setIsCleaning(false);
    }
  };

  const cacheLimitMb = Math.max(1, Math.round(preferences.tachieCacheMaxBytes / MB));
  const enableSummary =
    typeof activeSession?.settings.enableSummary === 'boolean' ? activeSession.settings.enableSummary : preferences.enableSummary;

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="text-sm font-semibold text-gray-800">全局设置</div>

      <div className="space-y-3">
        <div className="text-xs font-semibold text-gray-600">自动摘要</div>
        <label className="flex items-center justify-between gap-3 text-xs text-gray-700">
          <span>启用自动摘要</span>
          <input
            type="checkbox"
            checked={Boolean(enableSummary)}
            onChange={(event) => {
              const value = Boolean(event.target.checked);
              onPreferenceChange({ enableSummary: value });
              onSessionSettingChange({ enableSummary: value });
            }}
          />
        </label>
        <div className="text-[11px] text-gray-500">
          自动摘要会在上下文接近上限或连续丢弃过多历史时触发，关闭后仅保留手动摘要。
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-semibold text-gray-600">立绘缓存策略</div>
        <div className="text-[11px] text-gray-500">调整阈值后，可点击“清理超限”执行 LRU 清理。</div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">会话缓存上限</label>
            <input
              type="number"
              min={1}
              max={200}
              className="input-field !h-8 !px-2 !py-1 text-xs"
              value={String(preferences.tachieCacheMaxPerSession)}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                const value = Number.isFinite(nextValue) ? Math.max(1, Math.min(200, Math.floor(nextValue))) : 24;
                onPreferenceChange({ tachieCacheMaxPerSession: value });
              }}
            />
            <div className="text-[11px] text-gray-500">单会话最多保留 {limits.maxPerSession} 张。</div>
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-semibold text-gray-600">全局缓存上限</label>
            <input
              type="number"
              min={limits.maxPerSession}
              max={1000}
              className="input-field !h-8 !px-2 !py-1 text-xs"
              value={String(preferences.tachieCacheMaxGlobal)}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                const value = Number.isFinite(nextValue)
                  ? Math.max(limits.maxPerSession, Math.min(1000, Math.floor(nextValue)))
                  : limits.maxGlobal;
                onPreferenceChange({ tachieCacheMaxGlobal: value });
              }}
            />
            <div className="text-[11px] text-gray-500">全局最多保留 {limits.maxGlobal} 张。</div>
          </div>
        </div>

        <div className="grid gap-1">
          <label className="text-xs font-semibold text-gray-600">空间占用上限（MB）</label>
          <input
            type="number"
            min={32}
            max={5120}
            className="input-field !h-8 !px-2 !py-1 text-xs"
            value={String(cacheLimitMb)}
            onChange={(event) => {
              const nextBytes = parseMagicTeaPartyCacheLimitInput(event.target.value, preferences.tachieCacheMaxBytes);
              onPreferenceChange({ tachieCacheMaxBytes: nextBytes });
            }}
          />
          <div className="text-[11px] text-gray-500">当前上限：{Math.round(limits.maxBytes / MB)} MB。</div>
        </div>

        <div className="rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              缓存占用：{cacheStats.totalCount} 张 · {formatMagicTeaPartyBytes(cacheStats.totalBytes)}
              {cacheStats.unknownCount > 0 ? `（${cacheStats.unknownCount} 张大小待统计）` : ''}
              {cacheStats.expiredCount > 0 ? `（过期 ${cacheStats.expiredCount} 张）` : ''}
            </span>
            <span>清理阈值：{Math.round(limits.maxBytes / MB)} MB</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleCleanup()}
            disabled={isCleaning}
          >
            清理超限
          </button>
          <button
            type="button"
            className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleCleanupExpired()}
            disabled={isCleaning || cacheStats.expiredCount === 0}
          >
            清理过期
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleClearAll()}
            disabled={isCleaning || cacheStats.totalCount === 0}
          >
            清空全部
          </button>
          {isCleaning ? <span className="text-xs text-gray-500">处理中…</span> : null}
        </div>
      </div>

      {cacheError ? (
        <ErrorMessage
          message={cacheError}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
        />
      ) : null}
    </div>
  );
}
