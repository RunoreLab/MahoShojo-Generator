'use client';

import Link from 'next/link';

type ArenaRankingLinksProps = {
  onOpenRankingModal?: () => void;
  className?: string;
};

export function ArenaRankingLinks({ onOpenRankingModal, className }: ArenaRankingLinksProps) {
  return (
    <div className={className ?? 'flex items-center gap-3 text-sm flex-wrap'}>
      {onOpenRankingModal ? (
        <button
          type="button"
          onClick={onOpenRankingModal}
          className="text-blue-600 hover:underline font-semibold"
        >
          快速查看排行榜
        </button>
      ) : (
        <span className="text-blue-600 font-semibold">快速查看排行榜</span>
      )}
      <Link href="/ranking" className="text-blue-600 hover:underline">
        进入排行榜页
      </Link>
    </div>
  );
}
