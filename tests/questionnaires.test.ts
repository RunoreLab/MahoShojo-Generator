import { describe, expect, it } from 'bun:test';
import magicalGirlDefault from '@/public/questionnaires/presets/magical-girl-default.json';

describe('问卷字段配置', () => {
  it('默认魔法少女问卷的短答题有合理上限', () => {
    const questions = Array.isArray((magicalGirlDefault as any)?.questions) ? (magicalGirlDefault as any).questions : [];
    const nameQuestion = questions.find((q: any) => q?.id === 'MG-1');
    const nounQuestion = questions.find((q: any) => q?.id === 'MG-7');

    expect(nameQuestion?.maxLength).toBe(180);
    expect(typeof nameQuestion?.placeholder).toBe('string');
    expect(nounQuestion?.maxLength).toBe(200);
  });
});
