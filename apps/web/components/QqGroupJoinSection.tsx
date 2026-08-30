import { qqGroups, qqGroupJoinButtonImageUrl } from '@/lib/communityGroups';

interface QqGroupJoinSectionProps {
  className?: string;
}

export function QqGroupJoinSection({ className }: QqGroupJoinSectionProps) {
  return (
    <div className={className ?? 'text-center mt-3'}>
      <div className="text-sm text-gray-700 font-semibold">QQ 交流群（选择其一）</div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {qqGroups.map((group) => (
          <div key={group.groupCode} className="flex flex-col items-center">
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={group.joinUrl}
              title={group.name}
              aria-label={`加入QQ群：${group.name}（${group.groupCode}）`}
            >
              <img
                src={qqGroupJoinButtonImageUrl}
                alt={`加入QQ群：${group.name}`}
                width={92}
                height={24}
                style={{ border: 0 }}
              />
            </a>
            <div className="mt-1 text-xs text-gray-600">
              {group.name}（{group.groupCode}）
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
