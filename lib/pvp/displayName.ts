export type PvpDisplayNameInput = {
  userId?: number | null;
  username?: string | null;
  isBot?: boolean | null;
};

export function formatPvpDisplayName(input: PvpDisplayNameInput): string {
  const userId = typeof input.userId === 'number' && Number.isFinite(input.userId) ? input.userId : null;
  const rawUsername = typeof input.username === 'string' ? input.username.trim() : '';
  const username = rawUsername || (userId !== null ? `用户${userId}` : '未知玩家');
  return `${username}${input.isBot ? '（机器人）' : ''}`;
}

