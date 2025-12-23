export type PvpHumanSeat = { userId: number; seat: number };
export type PvpBotSeat = { botId: string; seat: number };

export type PvpSeatCompactionResult = {
  totalParticipants: number;
  humans: Array<PvpHumanSeat & { newSeat: number }>;
  bots: Array<PvpBotSeat & { newSeat: number }>;
};

const isValidSeat = (seat: unknown): seat is number => Number.isFinite(seat) && Math.floor(seat as number) === (seat as number) && (seat as number) >= 0;

export const compactPvpSeats = (input: {
  humans: PvpHumanSeat[];
  bots: PvpBotSeat[];
}): PvpSeatCompactionResult | { error: string } => {
  const humans = Array.isArray(input.humans) ? input.humans : [];
  const bots = Array.isArray(input.bots) ? input.bots : [];

  const entries: Array<{ kind: 'human'; userId: number; seat: number } | { kind: 'bot'; botId: string; seat: number }> = [];
  for (const h of humans) {
    if (!h || typeof h !== 'object') return { error: '参与者数据异常（human）' };
    if (!Number.isFinite(h.userId)) return { error: '参与者数据异常（human.userId）' };
    if (!isValidSeat(h.seat)) return { error: '参与者数据异常（human.seat）' };
    entries.push({ kind: 'human', userId: Math.floor(h.userId), seat: h.seat });
  }
  for (const b of bots) {
    if (!b || typeof b !== 'object') return { error: '参与者数据异常（bot）' };
    const botId = typeof b.botId === 'string' ? b.botId.trim() : '';
    if (!botId) return { error: '参与者数据异常（bot.botId）' };
    if (!isValidSeat(b.seat)) return { error: '参与者数据异常（bot.seat）' };
    entries.push({ kind: 'bot', botId, seat: b.seat });
  }

  const usedSeats = new Set<number>();
  for (const e of entries) {
    if (usedSeats.has(e.seat)) return { error: '座位冲突（存在重复 seat）' };
    usedSeats.add(e.seat);
  }

  const sorted = [...entries].sort((a, b) => a.seat - b.seat);
  const compactedHumans: Array<PvpHumanSeat & { newSeat: number }> = [];
  const compactedBots: Array<PvpBotSeat & { newSeat: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (entry.kind === 'human') compactedHumans.push({ userId: entry.userId, seat: entry.seat, newSeat: i });
    else compactedBots.push({ botId: entry.botId, seat: entry.seat, newSeat: i });
  }

  return { totalParticipants: sorted.length, humans: compactedHumans, bots: compactedBots };
};

