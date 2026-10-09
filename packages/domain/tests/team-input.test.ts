import { describe, expect, it } from 'vitest';
import { checkTeamBudget, checkTeamCompositionBudget, checkTeamResult, MAX_TEAM_INPUT_BYTES, parseTeamInput, projectUnsignedTeamData, teamMemberName } from '../src/team-input';
import { mergeTeamDataCards } from '../src/team-merge';

describe('local team input and resource bounds', () => {
  it('preserves original unknown extensions and projects only top-level authority fields', () => {
    const original = { codename: 'A', signature: 'unverified', isPreset: true, _native: 'true', _isNative: true, isNative: true, _extension: { signature: '故事署名', isNative: '人物用语', _keep: true } };
    const [data] = parseTeamInput(JSON.stringify(original));
    expect(data).toEqual(original);
    const projected = projectUnsignedTeamData(data as typeof original);
    expect(projected).toEqual({ codename: 'A', _extension: original._extension });
    expect(data).toEqual(original);
  });
  it('rejects unsafe, deep, unsupported and oversized input without partial additions', () => {
    expect(() => parseTeamInput('{"codename":"A","__proto__":{}}')).toThrow();
    expect(() => parseTeamInput(JSON.stringify({ codename: 'A', deep: JSON.parse('['.repeat(70) + '0' + ']'.repeat(70)) }))).toThrow();
    expect(() => parseTeamInput('[{"codename":"A"}, 1]')).toThrow();
    expect(() => parseTeamInput('{"templateId":"通用情景","title":"场景","content":"正文"}')).toThrow();
    expect(() => parseTeamInput(' '.repeat(MAX_TEAM_INPUT_BYTES + 1))).toThrow(/1 MiB/);
    expect(() => parseTeamInput(JSON.stringify(Array.from({ length: 33 }, () => ({ codename: 'A' }))))).toThrow(/32/);
    expect(() => checkTeamBudget(Array.from({ length: 33 }, () => ({ codename: 'A' })))).toThrow(/32/);
  });
  it('rejects prefix amplification before merging without truncating legitimate names', () => {
    const [data] = parseTeamInput(JSON.stringify({ codename: 'A'.repeat(10_000), userAnswers: Array.from({ length: 1000 }, () => 'x') }));
    checkTeamBudget([data]);
    expect(teamMemberName(data)).toHaveLength(10_000);
    expect(() => checkTeamCompositionBudget([{ label: teamMemberName(data), data }])).toThrow(/安全预算/);
    const short = { codename: 'A'.repeat(1000), appearance: { outfit: '衣服' } };
    expect(() => checkTeamCompositionBudget([{ label: teamMemberName(short), data: short }])).not.toThrow();
    expect(() => checkTeamResult({ content: 'x'.repeat(3 * 1024 * 1024) })).toThrow();
  });
  it('retains established numeric/boolean conversion, object-array labels and member order', () => {
    const a = { codename: 'A', stats: { level: 1, active: false }, skills: [{ title: '一', name: '不动', amount: 2 }], _custom: { detail: '保留' } };
    const b = { codename: 'B', stats: { level: 2, active: true }, skills: [{ name: '二' }] };
    const snapshot = JSON.stringify([a, b]);
    const result = mergeTeamDataCards([{ name: '乙', data: b }, { name: '甲', data: a }]);
    expect(result.data.stats).toEqual({ level: '【乙】2\n\n【甲】1', active: '【乙】true\n\n【甲】false' });
    expect(result.data.skills).toEqual([{ name: '【乙】二' }, { title: '【甲】一', name: '不动', amount: 2 }]);
    expect(result.data._custom).toEqual({ detail: '【甲】保留' });
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});
