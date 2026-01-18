import type { MagicTeaPartyNotice } from '@/lib/magic-tea-party/types';

type MagicTeaPartyNoticePanelProps = {
  notices?: MagicTeaPartyNotice[];
  onClearNotices?: () => void;
};

const NOTICE_STYLE: Record<MagicTeaPartyNotice['level'], { label: string; className: string }> = {
  error: { label: '错误', className: 'border-red-200 bg-red-50 text-red-700' },
  warning: { label: '警告', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  info: { label: '提示', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

export function MagicTeaPartyNoticePanel({ notices = [], onClearNotices }: MagicTeaPartyNoticePanelProps) {
  if (notices.length === 0) return null;

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4">
      <div className="space-y-2">
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
      </div>
      {onClearNotices ? (
        <button
          type="button"
          className="mt-2 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
          onClick={onClearNotices}
        >
          清除提示
        </button>
      ) : null}
    </div>
  );
}
