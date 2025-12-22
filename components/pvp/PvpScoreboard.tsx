'use client';

type ScoreEntry = { userId: number; wins: number };
type PvpScore = { winsByUserId: ScoreEntry[]; maxRounds: number };
type PvpPlayerLite = {
  userId: number;
  username: string;
  prefix?: string | null;
  seat?: number | null;
  isBot?: boolean;
};

type PvpScoreboardProps = {
  score: PvpScore | null | undefined;
  players: PvpPlayerLite[];
};

const buildDisplayName = (p: PvpPlayerLite): string => {
  const prefix = typeof p.prefix === 'string' && p.prefix ? `${p.prefix} ` : '';
  const username = typeof p.username === 'string' && p.username ? p.username : `用户${p.userId}`;
  return `${prefix}${username}${p.isBot ? '（机器人）' : ''}`;
};

export function PvpScoreboard({ score, players }: PvpScoreboardProps) {
  if (!score) return null;

  const playerById = new Map<number, PvpPlayerLite>();
  players.forEach((p) => {
    if (!p || typeof p.userId !== 'number') return;
    playerById.set(p.userId, p);
  });

  const entries = (Array.isArray(score.winsByUserId) ? score.winsByUserId : [])
    .map((x) => ({
      userId: typeof x?.userId === 'number' ? x.userId : 0,
      wins: typeof x?.wins === 'number' ? x.wins : 0,
    }))
    .filter((x) => Number.isFinite(x.userId))
    .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));

  const maxWins = entries.reduce((m, x) => Math.max(m, x.wins ?? 0), 0);
  const shouldHighlight = maxWins > 0;

  return (
    <div className="p-4 rounded-xl bg-white border text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-gray-900">计分板</div>
        <div className="text-xs text-gray-600">最多 {score.maxRounds} 轮</div>
      </div>
      <div className="mt-3 space-y-2">
        {entries.length <= 0 ? (
          <div className="text-xs text-gray-600">暂无胜场数据。</div>
        ) : (
          entries.map((x) => {
            const p = playerById.get(x.userId);
            const seat = typeof p?.seat === 'number' ? p.seat : null;
            const isTop = shouldHighlight && x.wins === maxWins;
            return (
              <div
                key={x.userId}
                className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${
                  isTop ? 'bg-green-50 border-green-200' : 'bg-gray-50'
                }`}
              >
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full bg-white border text-xs text-gray-700">
                    座位 {seat ?? '?'}
                  </span>
                  <span className={`font-semibold ${isTop ? 'text-green-800' : 'text-gray-900'}`}>
                    {p ? buildDisplayName(p) : `用户${x.userId}`}
                  </span>
                </div>
                <div
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border ${
                    isTop ? 'bg-white text-green-800 border-green-200' : 'bg-white text-gray-700 border-gray-200'
                  }`}
                  title="当前胜场"
                >
                  胜场 {x.wins ?? 0}
                </div>
              </div>
            );
          })
        )}
      </div>
      {shouldHighlight ? (
        <div className="text-xs text-gray-600 mt-2">已高亮当前胜场最高的玩家。</div>
      ) : null}
    </div>
  );
}

