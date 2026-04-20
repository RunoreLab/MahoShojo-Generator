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
          className="battle-lite-link font-semibold"
        >
          快速查看排行榜
        </button>
      ) : (
        <span className="battle-lite-link font-semibold">快速查看排行榜</span>
      )}
      <Link href="/ranking" className="battle-lite-link">
        进入排行榜页
      </Link>
    </div>
  );
}
