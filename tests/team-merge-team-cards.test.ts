import { describe, expect, it } from 'bun:test';
import { mergeTeamDataCards } from '@/lib/team/merge-team-cards';

describe('team/merge-team-cards', () => {
  it('merges magical girl cards with prefixed strings and flattened arrays', () => {
    const a = {
      codename: '星夜绽放',
      appearance: {
        outfit: '层叠的星辰斗篷',
        accessories: ''
      },
      analysis: {
        coreTraits: ['冷静', '坚定']
      },
      userAnswers: ['答案A'],
      signature: 'native-signature-should-be-removed'
    };

    const b = {
      codename: '晨曦回响',
      appearance: {
        outfit: '晨光披风',
        accessories: '银色发饰'
      },
      analysis: {
        coreTraits: ['热情']
      }
    };

    const result = mergeTeamDataCards([
      { name: '星夜绽放', data: a },
      { name: '晨曦回响', data: b }
    ]);

    expect(result.template).toBe('magical-girl');
    expect(result.data.codename).toBe('星夜绽放 & 晨曦回响');
    expect((result.data as any).signature).toBeUndefined();

    const appearance = result.data.appearance as any;
    expect(appearance.outfit).toBe('【星夜绽放】层叠的星辰斗篷\n\n【晨曦回响】晨光披风');
    expect(appearance.accessories).toBe('【晨曦回响】银色发饰');

    const traits = (result.data.analysis as any).coreTraits;
    expect(traits).toEqual(['【星夜绽放】冷静', '【星夜绽放】坚定', '【晨曦回响】热情']);

    expect(result.data.userAnswers).toEqual(['【星夜绽放】答案A']);
    expect(result.data._teamMembers).toEqual(['星夜绽放', '晨曦回响']);
  });

  it('merges canshou cards with record fields and prefixes labels in object arrays', () => {
    const a = {
      name: '暗影残兽',
      appearance: '黑雾凝形',
      userAnswers: {
        q1: 'A1'
      },
      current_state: {
        summary: '危险',
        fields: [
          { id: 'hp', label: 'HP', type: 'number', value: 10 }
        ]
      }
    };

    const b = {
      name: '烈焰残兽',
      appearance: '赤焰咆哮',
      userAnswers: {
        q1: 'B1',
        q2: 'B2'
      },
      current_state: {
        summary: '',
        fields: [
          { id: 'mp', label: 'MP', type: 'number', value: 5 }
        ]
      }
    };

    const result = mergeTeamDataCards([
      { name: '暗影残兽', data: a },
      { name: '烈焰残兽', data: b }
    ]);

    expect(result.template).toBe('canshou');
    expect(result.data.name).toBe('暗影残兽 & 烈焰残兽');

    const userAnswers = result.data.userAnswers as any;
    expect(userAnswers.q1).toBe('【暗影残兽】A1\n\n【烈焰残兽】B1');
    expect(userAnswers.q2).toBe('【烈焰残兽】B2');

    const fields = (result.data.current_state as any).fields;
    expect(fields).toHaveLength(2);
    expect(fields[0].label).toBe('【暗影残兽】HP');
    expect(fields[1].label).toBe('【烈焰残兽】MP');
  });

  it('degrades to general character card when templates differ in auto mode', () => {
    const magical = {
      codename: '星夜绽放',
      appearance: { outfit: '星辰斗篷' }
    };
    const canshou = {
      name: '暗影残兽',
      appearance: '黑雾凝形'
    };

    const result = mergeTeamDataCards([
      { name: '星夜绽放', data: magical },
      { name: '暗影残兽', data: canshou }
    ]);

    expect(result.template).toBe('general');
    expect(result.data.templateId).toBe('通用角色');
    expect(result.data.name).toBe('星夜绽放 & 暗影残兽');
    expect(typeof result.data.content).toBe('string');
    expect(result.data.content).toContain('【星夜绽放】');
    expect(result.data.content).toContain('【暗影残兽】');
  });
});

