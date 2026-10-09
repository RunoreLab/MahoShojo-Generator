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
});
