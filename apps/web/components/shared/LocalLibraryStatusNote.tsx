'use client';

import { HardDrive, ShieldAlert } from 'lucide-react';
import { formatLocalLibraryQuota, useLocalLibraryStorageStatus } from '@/lib/local-library/storage-status';

/**
 * 本地库存储状态提示（LIB-003）。
 *
 * 必须说清三件事：是否拿到持久化存储、占用了多少空间、清站点数据会发生什么。
 * 浏览器可能拒绝 `persist()`，那不影响本地库可用——只影响风险措辞的强度。
 */
export function LocalLibraryStatusNote({ className = '' }: { className?: string }) {
  const status = useLocalLibraryStorageStatus();

  const headline = (() => {
    if (!status.supported) return '当前浏览器无法提供本地库空间估计。';
    if (status.persisted === true) return '本地库已获得持久化存储，通常不会被浏览器自动清理。';
    if (status.persisted === false) return '本地库尚未获得持久化存储，浏览器在空间紧张时可能清理它。';
    return '本地库存储状态未知。';
  })();

  return (
    <div className={`rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-xs text-gray-600 ${className}`}>
      <p className="flex items-start gap-1.5">
        <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {headline}
          {status.supported ? <span className="ml-1 text-gray-500">（{formatLocalLibraryQuota(status.usage, status.quota)}）</span> : null}
        </span>
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-gray-500">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>本地库只保存在这台设备，不会跨设备同步；清除本站数据会一并删除它。</span>
      </p>
      {status.supported && status.persisted === false && !status.requestedPersist ? (
        <button
          type="button"
          disabled={status.busy}
          onClick={() => { void status.requestPersist(); }}
          className="mt-1.5 min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {status.busy ? '正在申请…' : '申请持久化存储'}
        </button>
      ) : null}
    </div>
  );
}
