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

  it('does not attach arena fields when creating new blank character cards', () => {
    const magicalGirl = createBlankDataCard('magical-girl') as any;
    expect('current_state' in magicalGirl).toBe(false);
    expect('arena_history' in magicalGirl).toBe(false);

    const canshou = createBlankDataCard('canshou') as any;
    expect('current_state' in canshou).toBe(false);
    expect('arena_history' in canshou).toBe(false);

    const general = createBlankDataCard('general') as any;
    expect('current_state' in general).toBe(false);
    expect('arena_history' in general).toBe(false);
  });

  it('creates a blank general scenario card with default content', () => {
    const blank = createBlankDataCard('general-scenario');
    expect(blank.templateId).toBe('通用情景');
    expect(blank.title).toBe('未命名情景');
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

  it('does not inject arena fields when converting to magical girl/canshou', () => {
    const sourceMg = {
      codename: '未写入竞技场的少女',
      appearance: { outfit: '外套' },
    };

    const { data: magical } = convertDataCard(sourceMg, 'magical-girl', 'unknown');
    expect('current_state' in magical).toBe(false);
    expect('arena_history' in magical).toBe(false);

    const sourceCs = {
      name: '未写入竞技场的残兽',
      appearance: '雾状',
    };

    const { data: canshou } = convertDataCard(sourceCs, 'canshou', 'unknown');
    expect('current_state' in canshou).toBe(false);
    expect('arena_history' in canshou).toBe(false);
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

  it('validateDataCard can detect general scenario type as scenario', () => {
    const generalScenario = {
      templateId: '通用情景',
      title: '测试情景',
      content: '# 舞台\\n- 灯光\\n- 幕布'
    };
    const result = validateDataCard(generalScenario);
    expect(result.success).toBe(true);
    expect(result.type).toBe('scenario');
    expect(inferTemplate(generalScenario)).toBe('general-scenario');
  });

  it('validateDataCard supports legacy general scenario name field', () => {
    const legacyGeneralScenario = {
      templateId: '通用情景',
      name: '旧版情景',
      content: '# 旧舞台\\n- 旧灯光\\n- 旧幕布'
    };
    const result = validateDataCard(legacyGeneralScenario);
    expect(result.success).toBe(true);
    expect(result.type).toBe('scenario');
    expect(inferTemplate(legacyGeneralScenario)).toBe('general-scenario');
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

  it('does not misclassify narrative history cards as scenario', () => {
    const history = {
      templateId: 'narrative-history',
      version: 1,
      title: '叙事历史',
      updatedAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      entries: []
    };

    const result = validateDataCard(history);
    expect(result.success).toBe(true);
    expect(result.type).toBe('history');
    expect(inferTemplate(history)).toBe('unknown');
  });

  it('converts structured scenario into general scenario markdown', () => {
    const scenario = {
      title: '雨夜的便利店',
      scenario_type: '日常',
      description: '一段短暂但值得回味的相遇。',
      elements: {
        scene: { time: '深夜', place: '便利店', features: '雨声与霓虹灯' },
        roles: [],
        events: '偶遇并交换秘密',
        atmosphere: '安静',
        development: ['留下联系方式']
      }
    };

    const { data: generalScenario } = convertDataCard(scenario, 'general-scenario', 'scenario');
    expect(generalScenario.templateId).toBe('通用情景');
    expect(generalScenario.title).toBe('雨夜的便利店');
    expect(generalScenario.content).toContain('# scenario_type');
    expect(generalScenario.content).toContain('日常');
  });

  it('preserves _battle_story when converting between scenario and general-scenario', () => {
    const scenario = {
      title: '朝生暮死',
      description: '固定五章',
      elements: {
        scene: { time: '破晓前', place: '收容井', features: '静止水滴' },
        roles: [],
        events: '解除拘束',
        atmosphere: '冷酷',
        development: [],
      },
      _battle_story: {
        total_chapters: 5,
        plan_mode: 'fixed',
      },
    };

    const { data: generalScenario } = convertDataCard(scenario, 'general-scenario', 'scenario');
    expect((generalScenario as any)._battle_story).toEqual({
      total_chapters: 5,
      plan_mode: 'fixed',
    });

    const { data: structuredScenario } = convertDataCard(generalScenario, 'scenario', 'general-scenario');
    expect((structuredScenario as any)._battle_story).toEqual({
      total_chapters: 5,
      plan_mode: 'fixed',
    });
  });

  it('drops _battle_story when converting scenario into character-like templates', () => {
    const scenario = {
      title: '固定五章情景',
      description: '不应污染角色卡',
      elements: {
        scene: { time: '夜', place: '塔顶', features: '风很大' },
        roles: [],
        events: '交锋',
        atmosphere: '紧张',
        development: [],
      },
      _battle_story: {
        total_chapters: 5,
        plan_mode: 'fixed',
      },
    };

    const { data: generalCharacter } = convertDataCard(scenario, 'general', 'scenario');
    expect((generalCharacter as any)._battle_story).toBeUndefined();
    expect(generalCharacter.content).not.toContain('_battle_story');
  });
});
