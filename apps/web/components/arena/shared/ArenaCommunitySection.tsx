'use client';

import { qqGroups } from '@/lib/communityGroups';

type ArenaCommunitySectionProps = {
  className?: string;
};

export function ArenaCommunitySection({ className }: ArenaCommunitySectionProps) {
  return (
    <div className={className}>
      <div className="text-center">
        <div className="battle-lite-muted-text text-sm font-semibold">
          点击加入QQ群（任选其一）：
          <div className="battle-lite-link text-sm font-semibold">
            {qqGroups.map((group, index) => (
              <span key={group.groupCode}>
                {index > 0 ? ' / ' : ' '}
                <a
                  href={group.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  title={group.name}
                >
                  {group.groupCode}
                </a>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="text-center mt-3">
        <a
          href="https://pd.qq.com/s/brisxifbl"
          target="_blank"
          rel="noopener noreferrer"
          className="battle-lite-link text-sm font-semibold"
        >
          点击加入腾讯频道
        </a>
      </div>
    </div>
  );
}
