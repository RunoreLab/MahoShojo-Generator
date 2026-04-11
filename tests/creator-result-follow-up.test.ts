import { describe, expect, test } from 'bun:test';

import {
  buildStructuredCreatorPortraitPrompt,
  getStructuredCreatorResultFollowUp,
} from '@/lib/creator/result-follow-up';

describe('creator result follow-up', () => {
  test('魔法少女结果沿用 appearance 对象并追加魔法少女立绘提示词', () => {
    const prompt = buildStructuredCreatorPortraitPrompt('magical-girl', {
      appearance: {
        outfit: '白金礼裙',
        accessories: '星芒发饰',
        colorScheme: '月白与金',
        overallLook: '圣洁',
      },
    });

    expect(prompt).toContain('outfit');
    expect(prompt).toContain('Xiabanmo');
    expect(prompt).toContain('魔法少女');
  });

  test('残兽结果使用残兽字段摘要，不混入魔法少女提示词', () => {
    const prompt = buildStructuredCreatorPortraitPrompt('canshou', {
      appearance: '镜面般的碎裂外壳',
      materialAndSkin: '湿冷玻璃与薄膜',
      featuresAndAppendages: '尾端带钩的镜刺',
      coreConcept: '反照',
    });

    expect(prompt).toBe('镜面般的碎裂外壳, 湿冷玻璃与薄膜, 尾端带钩的镜刺');
    expect(prompt).not.toContain('魔法少女');
  });

  test('残兽后续操作文案与下载文件名使用残兽口径', () => {
    const followUp = getStructuredCreatorResultFollowUp('canshou', {
      name: '灰烬追猎者',
    });

    expect(followUp.battleLinkText).toBe('前往竞技场，让它大闹一场！→');
    expect(followUp.downloadFileName).toBe('残兽档案_灰烬追猎者.json');
    expect(followUp.downloadButtonText).toBe('💾 下载残兽档案');
  });
});
