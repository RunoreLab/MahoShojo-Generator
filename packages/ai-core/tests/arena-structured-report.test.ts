import { describe, expect, it } from 'vitest';
import { buildArenaStructuredReportSchema, parseArenaStructuredReportJson } from '../src/arena-generation';
const report = {
  headline: '雨夜', article: { body: '重逢', analysis: '观察' },
  officialReport: { winner: '平局', conclusion: '遵守约定' },
};
describe('Arena structured report compatibility schema', () => {
  it.each([false, true])('retains required output fields; impacts=%s', (enabled) => {
    const options = { enableImpacts: enabled, enableImpactText: enabled, enableCurrentState: enabled };
    const value = { ...report, impacts: [{ characterName: '雪绒', impact: '成长', currentStateSummary: '持伞' }] };
    expect(parseArenaStructuredReportJson(JSON.stringify(value), options)).toEqual(enabled ? value : report);
    expect(buildArenaStructuredReportSchema(options).safeParse({ ...value, headline: null }).success).toBe(false);
    expect(parseArenaStructuredReportJson('broken', options)).toBeNull();
  });
  it('independently selects impact text and current state, without promoting extra model fields', () => {
    const options = { enableImpacts: true, enableImpactText: false, enableCurrentState: true };
    expect(parseArenaStructuredReportJson(JSON.stringify({ ...report,
      impacts: [{ characterName: '雪绒', currentStateSummary: '持伞', impact: 'discarded' }],
      reasoning: 'not story', signature: 'not authority',
    }), options)).toEqual({ ...report, impacts: [{ characterName: '雪绒', currentStateSummary: '持伞' }] });
  });

  it('uses non-combat daily field descriptions when mode=daily while keeping schema compatible', () => {
    const options = { enableImpacts: true, enableImpactText: true, enableCurrentState: true, mode: 'daily' as const };
    const schema = buildArenaStructuredReportSchema(options);
    const officialReportShape = (schema.shape.officialReport as unknown as { shape: { winner: { description?: string } } }).shape;
    expect(schema.shape.headline.description).not.toContain('震惊体');
    expect(officialReportShape.winner.description).toContain('日常模式默认无胜负');
    expect(parseArenaStructuredReportJson(JSON.stringify({
      ...report,
      impacts: [{ characterName: '雪绒', impact: '一起逛店', currentStateSummary: '心情轻松' }],
    }), options)).toEqual({
      ...report,
      impacts: [{ characterName: '雪绒', impact: '一起逛店', currentStateSummary: '心情轻松' }],
    });
  });
});
