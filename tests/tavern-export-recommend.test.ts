import { describe, expect, it } from 'vitest';

import { recommendTavernExportFields } from '@/lib/tavern-card';

describe('tavern-export-recommend', () => {
  it('能基于魔法少女 userAnswers 生成开场白与对话样例', () => {
    const card = {
      codename: '测试魔法少女',
      magicConstruct: { form: '法杖', basicAbilities: ['治愈', '结界'] },
      wonderlandRule: { tendency: '守护' },
      blooming: { powerLevel: '高' },
      userAnswers: ['1.雪铁龙', '2.我会冲上去救她', '3.我会握住她的手告诉她已经足够好了'],
    };

    const result = recommendTavernExportFields('magical-girl', card, []);
    expect(result.tags).toContain('魔法少女');
    expect(result.tags).not.toContain('法杖');
    expect(result.firstMes).toBe('雪铁龙');
    expect(result.mesExample).toContain('{{user}}: 你的真实名字是？');
    expect(result.mesExample).toContain('{{char}}: 雪铁龙');
    expect(result.mesExample).not.toContain('{{char}}: 1.');
  });

  it('能基于残兽字段补全基础标签', () => {
    const card = {
      name: '测试残兽',
      evolutionStage: '蛹',
      coreConcept: '腐蚀',
      coreEmotion: '吞噬欲',
      origin: '野生',
    };

    const result = recommendTavernExportFields('canshou', card, []);
    expect(result.tags).toContain('残兽');
    expect(result.tags).toContain('蛹');
    expect(result.tags).toContain('腐蚀');
    expect(result.tags).not.toContain('吞噬欲');
    expect(result.tags).not.toContain('野生');
  });
});
