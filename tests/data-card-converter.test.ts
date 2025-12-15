import { describe, expect, it } from 'bun:test';
import {
  createBlankDataCard,
  convertDataCard,
  inferTemplate
} from '@/lib/data-card-converter';
import { inferTemplateId, validateDataCard } from '@/lib/schemas';

describe('data-card-converter', () => {
  it('creates a blank general character card with default content', () => {
    const blank = createBlankDataCard('general');
    expect(blank.templateId).toBe('通用角色');
    expect(blank.name).toBe('未命名角色');
    expect(typeof blank.content).toBe('string');
    expect(blank.content.length).toBeGreaterThan(0);
  });

  it('converts magical girl data into general character markdown', () => {
    const magical = {
      codename: '星夜绽放',
      appearance: {
        outfit: '层叠的星辰斗篷',
        colorScheme: '深蓝与银白'
      },
      analysis: {
        personalityAnalysis: '沉静且坚定',
        predictionBasis: '来自星座的指引'
      },
      templateId: '魔法少女/心之花/魔法少女（问卷生成）'
    };

    const { data: general } = convertDataCard(magical, 'general', 'magical-girl');
    expect(general.templateId).toBe('通用角色');
    expect(general.name).toBe('星夜绽放');
    expect(general.content).toContain('# appearance');
    expect(general.content).toContain('沉静且坚定');
  });

  it('converts general character into scenario role entry', () => {
    const general = {
      templateId: '通用角色',
      name: '流浪写手',
      content: '在城市的雨夜记录每一次奇迹。'
    };

    const { data: scenario } = convertDataCard(general, 'scenario', 'general');
    expect(scenario.elements.roles).toBeDefined();
    expect(scenario.elements.roles?.length).toBeGreaterThan(0);
    const role = scenario.elements.roles?.[0];
    expect(role?.name).toBe('流浪写手');
    expect(role?.description).toContain('在城市的雨夜');
  });

  it('appends unmatched fields when converting to magical girl', () => {
    const source = {
      codename: '无秩序之花',
      templateId: '魔法少女/心之花/魔法少女（问卷生成）',
      unknownField: '额外的设定'
    };

    const { data: magical } = convertDataCard(source, 'magical-girl', 'magical-girl');
    expect(magical.analysis?.predictionBasis).toContain('unknownField');
    expect(magical.analysis?.predictionBasis).toContain('额外的设定');
  });

  it('validateDataCard can detect general character type', () => {
    const general = {
      templateId: '通用角色',
      name: '测试角色',
      content: '这是角色的 Markdown 描述。'
    };
    const result = validateDataCard(general);
    expect(result.success).toBe(true);
    expect(result.type).toBe('general');
    expect(inferTemplate(general)).toBe('general');
  });

  it('keeps general classification even when content is empty string', () => {
    const minimalGeneral = {
      templateId: '通用角色',
      name: '末伏之夜',
      content: ''
    };
    expect(inferTemplate(minimalGeneral)).toBe('general');
    expect(inferTemplateId(minimalGeneral)).toBe('通用角色');
  });

  it('inferTemplate prefers general for name-only cards without templateId', () => {
    const legacy = { name: '未标记角色' };
    expect(inferTemplate(legacy)).toBe('general');
    expect(inferTemplateId(legacy)).toBe('通用角色');
  });

  it('inferTemplateId detects canshou features when present', () => {
    const beast = { name: '侵蚀体', materialAndSkin: '晶体' };
    expect(inferTemplate(beast)).toBe('canshou');
    expect(inferTemplateId(beast)).toBe('魔法少女/心之花/残兽（问卷生成）');
  });

  it('inferTemplateId distinguishes magical girls by codename and construct', () => {
    const mgWithConstruct = { codename: '光刃', magicConstruct: { name: '光刃' } };
    expect(inferTemplateId(mgWithConstruct)).toBe('魔法少女/心之花/魔法少女（问卷生成）');

    const mgNameOnly = { codename: '星辉' };
    expect(inferTemplateId(mgNameOnly)).toBe('魔法少女/心之花/魔法少女（名字生成）');
  });
});
