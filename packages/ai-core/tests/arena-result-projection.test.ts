import { describe, expect, it } from 'vitest';
import { projectArenaBattleReport, projectArenaUpdatedRoster, toBattleReportMarkdown, type ArenaBattleReport } from '../src/arena-generation';
const original = {
  headline: ' 标题 ', scenario: '旧情景', reporterInfo: { name: '记者', publication: '刊物' },
  article: { body: ' 正文 ', analysis: '记者点评' }, officialReport: { winner: ' 甲 ', conclusion: ' 结局 ' },
  aiReasoning: { status: 'done', source: 'provider', text: '独立思考' },
  extension: { opaque: { keep: true } },
} satisfies ArenaBattleReport & { extension: unknown };
describe('pure Arena result display projection', () => {
  it('preserves extensions and leaves inputs untouched, without mixing reasoning into history Markdown', () => {
    const projected = projectArenaBattleReport({ report: original, mode: 'classic', scenarioDisplayName: '忽略', sanitizeText: (text) => text.trim() });
    expect(projected.scenario).toBeUndefined();
    expect(original.scenario).toBe('旧情景');
    expect(projected.extension).toBe(original.extension);
    expect(projected.aiReasoning?.text).toBe('独立思考');
    expect(toBattleReportMarkdown(projected)).toBe('# 标题\n\n正文\n\n## 胜利者\n\n- 甲\n\n## 最终结果\n\n结局');
  });
  it('Web payload remains exact while its scenario label follows the active mode', () => {
    const source = ' <html>原始内容</html> ';
    const projected = projectArenaBattleReport({ report: { ...original, reportFormat: 'web', webHtml: source }, mode: 'scenario', scenarioDisplayName: ' 新情景 ', sanitizeText: () => '过滤' });
    expect(projected.webHtml).toBe(source);
    expect(projected.headline).toBe(original.headline);
    expect(projected.scenario).toBe('过滤');
  });
  it('retains host roster fields and entire returned extensions without re-signing cards', () => {
    const roster = [{ data: { name: '甲', old: true }, sourceDataCardId: 'id', teamId: 2 }, { data: { name: '乙' } }];
    const updated = { name: '甲', extension: { current_state: { unknown: 'keep' } }, signature: 'server-returned' };
    const next = projectArenaUpdatedRoster(roster, [updated]);
    expect(next[0]).toEqual({ ...roster[0], data: updated });
    expect(next[0].data).toBe(updated);
    expect(next[1]).toBe(roster[1]);
    expect(roster[0].data).not.toHaveProperty('signature');
  });
});
