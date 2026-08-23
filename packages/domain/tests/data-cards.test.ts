import {
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
  inferCharacterKind,
  inferTemplateId,
} from '@mahoshojo/domain/data-cards';

describe('数据卡领域分类', () => {
  it('显式模板优先于字段特征', () => {
    expect(inferCharacterKind({ templateId: GENERAL_CHARACTER_TEMPLATE_ID, codename: '不应覆盖模板' })).toBe('general');
    expect(inferCharacterKind({ templateId: GENERAL_SCENARIO_TEMPLATE_ID, name: '情景' })).toBe('unknown');
    expect(inferCharacterKind({ templateId: '魔法少女/心之花/残兽（问卷生成）', codename: '不应被视为魔法少女' })).toBe('canshou');
    expect(inferCharacterKind({ templateId: '魔法少女/心之花/魔法少女（名字生成）', name: '不应被视为通用角色' })).toBe('magical-girl');
  });

  it('兼容缺少 templateId 的既有角色数据', () => {
    expect(inferCharacterKind({ name: '自由角色', content: 'Markdown 设定' })).toBe('general');
    expect(inferCharacterKind({ codename: '心之花' })).toBe('magical-girl');
    expect(inferCharacterKind({ name: '残兽', coreConcept: '恐惧' })).toBe('canshou');
    expect(inferCharacterKind({ name: '只有名字' })).toBe('general');
    expect(inferCharacterKind({ title: '不是角色' })).toBe('unknown');
    expect(inferCharacterKind(null)).toBe('unknown');
  });

  it('为旧角色给出与当前 Web 逻辑一致的模板标识', () => {
    expect(inferTemplateId({ codename: '小圆', magicConstruct: {} })).toBe('魔法少女/心之花/魔法少女（问卷生成）');
    expect(inferTemplateId({ codename: '小圆' })).toBe('魔法少女/心之花/魔法少女（名字生成）');
    expect(inferTemplateId({ name: '残兽', attackMethod: '冲撞' })).toBe('魔法少女/心之花/残兽（问卷生成）');
    expect(inferTemplateId({ name: '自由角色', content: 'Markdown 设定' })).toBe(GENERAL_CHARACTER_TEMPLATE_ID);
    expect(inferTemplateId({ title: '未知内容' })).toBe('魔法少女/心之花/未知');
  });
});

describe('@mahoshojo/domain 公共入口', () => {
  it('根入口导出同一份数据卡领域 API', async () => {
    const domain = await import('@mahoshojo/domain');

    expect(domain.GENERAL_CHARACTER_TEMPLATE_ID).toBe(GENERAL_CHARACTER_TEMPLATE_ID);
    expect(domain.GENERAL_SCENARIO_TEMPLATE_ID).toBe(GENERAL_SCENARIO_TEMPLATE_ID);
    expect(domain.inferCharacterKind({ codename: '心之花' })).toBe('magical-girl');
  });
});
