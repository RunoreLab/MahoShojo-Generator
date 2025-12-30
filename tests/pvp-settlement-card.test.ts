import { describe, expect, it } from 'bun:test';

import { buildPvpSettlementRoundSummary, parsePvpRoundResultJson } from '@/lib/pvp/settlement-card';

describe('pvp settlement card', () => {
  it('parses round result json and extracts headline/combatants', () => {
    const raw = JSON.stringify({
      winnerUserId: 12,
      winnerName: '星光之刃',
      winnerSeat: 1,
      winnerIsBot: false,
      winnerStatus: 'final',
      combatants: [
        { userId: 12, seat: 1, isBot: false, snapshotId: 'snap_a', name: '星光之刃', type: 'magical-girl' },
        { userId: 99, seat: 2, isBot: false, snapshotId: 'snap_b', name: '残兽·灰雾', type: 'canshou' },
      ],
      report: { headline: '月下决斗', officialReport: { winner: '星光之刃' } },
    });

    const parsed = parsePvpRoundResultJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.report?.headline).toBe('月下决斗');
    expect(parsed?.combatants.length).toBe(2);
    expect(parsed?.winnerSeat).toBe(1);
  });

  it('builds summary with winner and my play', () => {
    const raw = JSON.stringify({
      winnerUserId: 12,
      winnerName: '星光之刃',
      winnerSeat: 1,
      winnerIsBot: false,
      combatants: [
        { userId: 12, seat: 1, isBot: false, snapshotId: 'snap_a', name: '星光之刃', type: 'magical-girl' },
        { userId: 99, seat: 2, isBot: false, snapshotId: 'snap_b', name: '残兽·灰雾', type: 'canshou' },
      ],
      report: { headline: '月下决斗' },
    });

    const result = parsePvpRoundResultJson(raw);
    const summary = buildPvpSettlementRoundSummary({
      roundId: 'r1',
      roundIndex: 1,
      status: 'completed',
      result,
      usernameByUserId: new Map([
        [12, '小明'],
        [99, '小红'],
      ]),
      isBotByUserId: new Map([
        [12, false],
        [99, false],
      ]),
      myUserId: 99,
    });

    expect(summary.headline).toBe('月下决斗');
    expect(summary.winner.status).toBe('final');
    expect(summary.winner.userId).toBe(12);
    expect(summary.winner.characterName).toBe('星光之刃');
    expect(summary.myPlay?.snapshotId).toBe('snap_b');
    expect(summary.myPlay?.name).toBe('残兽·灰雾');
  });

  it('treats missing winner as draw on completed rounds', () => {
    const raw = JSON.stringify({
      winnerUserId: null,
      winnerName: null,
      winnerSeat: null,
      winnerIsBot: null,
      combatants: [],
      report: { headline: '调查院接管' },
    });

    const result = parsePvpRoundResultJson(raw);
    const summary = buildPvpSettlementRoundSummary({
      roundId: 'r2',
      roundIndex: 2,
      status: 'completed',
      result,
      usernameByUserId: new Map(),
      isBotByUserId: new Map(),
      myUserId: 1,
    });

    expect(summary.winner.status).toBe('draw');
    expect(summary.winner.username).toBe('平局');
  });

  it('treats non-completed rounds as pending', () => {
    const summary = buildPvpSettlementRoundSummary({
      roundId: 'r3',
      roundIndex: 3,
      status: 'pending',
      result: null,
      usernameByUserId: new Map(),
      isBotByUserId: new Map(),
      myUserId: 1,
    });

    expect(summary.winner.status).toBe('pending');
    expect(summary.headline).toBeNull();
  });
});

