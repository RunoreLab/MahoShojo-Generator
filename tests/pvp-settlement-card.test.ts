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

  it('extracts headline from reportMarkdown for stream results', () => {
    const raw = JSON.stringify({
      generationMode: 'stream',
      winnerUserId: 12,
      winnerName: '星光之刃',
      winnerSeat: 1,
      winnerIsBot: false,
      combatants: [{ userId: 12, seat: 1, isBot: false, snapshotId: 'snap_a', name: '星光之刃', type: 'magical-girl' }],
      reportMarkdown: '# 月下决斗\n\n## 胜利者\n星光之刃',
    });

    const result = parsePvpRoundResultJson(raw);
    const summary = buildPvpSettlementRoundSummary({
      roundId: 'r4',
      roundIndex: 4,
      status: 'completed',
      result,
      usernameByUserId: new Map([[12, '小明']]),
      isBotByUserId: new Map([[12, false]]),
      myUserId: 12,
    });

    expect(summary.headline).toBe('月下决斗');
  });

  it('resolves bot winner userId/name by seat for finished rooms', () => {
    const raw = JSON.stringify({
      winnerUserId: null,
      winnerName: '钢铁蔷薇',
      winnerSeat: 2,
      winnerIsBot: true,
      combatants: [
        { userId: null, seat: 2, isBot: true, snapshotId: 'snap_bot', name: '钢铁蔷薇', type: 'magical-girl' },
      ],
      report: { headline: '终局之战' },
    });

    const result = parsePvpRoundResultJson(raw);
    const summary = buildPvpSettlementRoundSummary({
      roundId: 'r6',
      roundIndex: 6,
      status: 'completed',
      result,
      usernameByUserId: new Map([[-3, '小机器人']]),
      isBotByUserId: new Map([[-3, true]]),
      userIdBySeat: new Map([[2, -3]]),
      myUserId: 1,
    });

    expect(summary.winner.userId).toBe(-3);
    expect(summary.winner.username).toBe('小机器人（机器人）');
  });

  it('falls back to first non-empty line when markdown has no heading', () => {
    const raw = JSON.stringify({
      generationMode: 'stream',
      winnerUserId: null,
      winnerName: null,
      winnerSeat: null,
      combatants: [],
      reportMarkdown: '这是一条没有标题的战报第一行\\n\\n后续内容…',
    });

    const result = parsePvpRoundResultJson(raw);
    const summary = buildPvpSettlementRoundSummary({
      roundId: 'r5',
      roundIndex: 5,
      status: 'completed',
      result,
      usernameByUserId: new Map(),
      isBotByUserId: new Map(),
      myUserId: 1,
    });

    expect(summary.headline).toBe('这是一条没有标题的战报第一行');
  });
});
