import { describe, expect, it } from 'bun:test';

import { buildPvpSensitiveArrestWarrantReport } from '@/lib/pvp/arrest-warrant';

describe('buildPvpSensitiveArrestWarrantReport', () => {
  it('生成逮捕令战报并默认判定平局', () => {
    const report = buildPvpSensitiveArrestWarrantReport({
      roomId: 'room_abcdef',
      matchId: 'match_12345678',
      roundId: 'round_deadbeef',
      reason: '使用危险符文',
      issuedAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    expect(report.headline).toContain('逮捕令');
    expect(report.reporterInfo.publication).toBe('魔法国度调查院');
    expect(report.officialReport.winner).toBe('平局');
    expect(report.officialReport.conclusion).toContain('平局');
    expect(report.article.body).toContain('## 逮捕令');
    expect(report.article.body).toContain('批 准 逮 捕');
    expect(report.article.body).toContain('案件编号');
    expect(report.article.body).toContain('签发时间');
    expect(report.article.body).toContain('2020-01-01 00:00:00Z');
    expect(report.article.body).toContain('事由');
    expect(report.article.body).toContain('使用危险符文');
    expect(report.article.body).toContain('城际网络并非法外之地');
  });
});

