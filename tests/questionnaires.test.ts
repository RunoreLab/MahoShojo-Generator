import { describe, expect, it } from 'bun:test';
import magicalGirlDefault from '@/public/questionnaires/presets/magical-girl-default.json';
import presetIndex from '@/public/questionnaires/presets/index.json';
import wastetraceTraveler from '@/public/questionnaires/presets/magical-girl-wastetrace-traveler.json';

describe('问卷字段配置', () => {
  it('默认魔法少女问卷的短答题有合理上限', () => {
    const questions = Array.isArray((magicalGirlDefault as any)?.questions) ? (magicalGirlDefault as any).questions : [];
    const nameQuestion = questions.find((q: any) => q?.id === 'MG-1');
    const nounQuestion = questions.find((q: any) => q?.id === 'MG-7');

    expect(nameQuestion?.maxLength).toBe(180);
    expect(typeof nameQuestion?.placeholder).toBe('string');
    expect(nounQuestion?.maxLength).toBe(200);
  });

  it('废土行迹旅人问卷预设具备预期元数据与首题', () => {
    const questions = Array.isArray((wastetraceTraveler as any)?.questions) ? (wastetraceTraveler as any).questions : [];
    const firstQuestion = questions[0] as { question?: unknown } | undefined;
    const locationQuestion = questions.find((q: any) => q?.id === 'WT-04');
    const combinedLocationCopy = [
      locationQuestion?.question,
      locationQuestion?.placeholder,
      locationQuestion?.helperText,
      ...(Array.isArray(locationQuestion?.suggestions) ? locationQuestion.suggestions : []),
    ].join(' ');
    const loreMarkdown = typeof (wastetraceTraveler as any)?.loreMarkdown === 'string'
      ? (wastetraceTraveler as any).loreMarkdown as string
      : '';

    expect((wastetraceTraveler as any)?.kind).toBe('magical-girl');
    expect((wastetraceTraveler as any)?.nativeAllowed).toBe(true);
    expect(typeof loreMarkdown).toBe('string');
    expect(loreMarkdown.trim().length).toBeGreaterThan(0);
    expect(loreMarkdown).toContain('不要套用魔法少女或残兽术语');
    expect(loreMarkdown).toContain('超大核心城市或万能中枢');
    expect(loreMarkdown).not.toContain('神术师');
    expect(questions).toHaveLength(17);
    expect(typeof firstQuestion?.question).toBe('string');
    expect(firstQuestion?.question).toContain('名字');
    expect(typeof locationQuestion?.helperText).toBe('string');
    expect(locationQuestion?.helperText).toContain('开放度');
    expect(combinedLocationCopy).not.toContain('学城');
  });

  it('废土行迹旅人问卷已加入预设索引', () => {
    const entries = Array.isArray((presetIndex as any)?.presets) ? (presetIndex as any).presets : [];
    const target = entries.find((item: any) => item?.id === 'magical-girl-wastetrace-traveler');

    expect(target).toEqual(expect.objectContaining({
      id: 'magical-girl-wastetrace-traveler',
      kind: 'magical-girl',
      path: '/questionnaires/presets/magical-girl-wastetrace-traveler.json',
    }));
  });
});
