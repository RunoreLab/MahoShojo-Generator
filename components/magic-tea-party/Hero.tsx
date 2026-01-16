import Link from 'next/link';

import { ErrorMessage } from '@/components/ErrorMessage';
import type { MagicTeaPartyNotice } from '@/lib/magic-tea-party/types';

type MagicTeaPartyHeroProps = {
  globalError: string | null;
  notices?: MagicTeaPartyNotice[];
  onClearNotices?: () => void;
};

const NOTICE_STYLE: Record<MagicTeaPartyNotice['level'], { label: string; className: string }> = {
  error: { label: '错误', className: 'border-red-200 bg-red-50 text-red-700' },
  warning: { label: '警告', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  info: { label: '提示', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

export function MagicTeaPartyHero({ globalError, notices = [], onClearNotices }: MagicTeaPartyHeroProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pink-800">魔法茶会</h1>
          <p className="mt-1 text-sm text-gray-600">聊天记录保存在本地浏览器；魔法茶会仅支持自备 API Key。</p>
        </div>
        <Link href="/" className="text-sm text-pink-700 hover:underline">
          返回首页
        </Link>
      </div>

      {globalError ? (
        <div className="mt-4">
          <ErrorMessage
            message={globalError}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
          />
        </div>
      ) : null}

      {notices.length > 0 ? (
        <div className="mt-4 space-y-2">
          {notices.map((notice, index) => {
            const style = NOTICE_STYLE[notice.level] ?? NOTICE_STYLE.info;
            const code = notice.code?.trim();
            return (
              <div key={`${code || notice.message}-${index}`} className={`rounded-lg border px-4 py-3 text-sm ${style.className}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{style.label}</span>
                  {code ? <span className="text-xs opacity-80">{code}</span> : null}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{notice.message}</div>
              </div>
            );
          })}
          {onClearNotices ? (
            <button
              type="button"
              className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
              onClick={onClearNotices}
            >
              清除提示
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
