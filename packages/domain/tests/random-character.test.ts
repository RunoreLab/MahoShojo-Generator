import { describe, expect, it } from 'vitest';

import { generateRandomCanshou, generateRandomMagicalGirl } from '../src/random-character';

describe('random-character', () => {
  it('生成的魔法少女设定聚合各素材段并带问卷模板标识', () => {
    const result = generateRandomMagicalGirl();
    expect(result.templateId).toBe('魔法少女/心之花/魔法少女（问卷生成）');
    expect(result.magicConstruct).toBeDefined();
    expect(result.wonderlandRule).toBeDefined();
    expect(result.blooming).toBeDefined();
    expect(result.analysis).toBeDefined();
  });

  it('生成的残兽设定聚合各素材段并带问卷模板标识', () => {
    const result = generateRandomCanshou();
    expect(result.templateId).toBe('魔法少女/心之花/残兽（问卷生成）');
  });

  it('重复生成返回合法对象（素材空档时回退空对象段）', () => {
    for (let index = 0; index < 5; index += 1) {
      expect(generateRandomMagicalGirl()).toBeTypeOf('object');
      expect(generateRandomCanshou()).toBeTypeOf('object');
    }
  });
});
