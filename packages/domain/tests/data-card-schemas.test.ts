import { describe, expect, it } from 'vitest';

import {
  createBlankDataCard,
  convertDataCard,
} from '@mahoshojo/domain/sublimation';
import { parseDataCardByTemplate } from '@mahoshojo/domain/data-card-schemas';

/**
 * 五模板 schema 门禁（D5.1-P2-r5-r1）：Web `data-card-converter` 与 Desktop
 * 角色管理共用同一组 `Schema.parse`。转换实现自身 schema-neutral，这里验证
 * 的正是「门禁存在」——非法结构即抛，而不是静默透传。
 */
describe('parseDataCardByTemplate', () => {
  it('五个模板的空白卡都各自过 schema', () => {
    for (const template of ['magical-girl', 'canshou', 'general', 'scenario', 'general-scenario'] as const) {
      expect(() => parseDataCardByTemplate(template, createBlankDataCard(template))).not.toThrow();
    }
  });

  it('结构化情景卡的 elements 必须是对象，title 必填', () => {
    expect(() => parseDataCardByTemplate('scenario', {
      title: '雾港',
      elements: { scene: { time: '夜' } },
    })).not.toThrow();
    // elements 缺失或不是对象都非法。
    expect(() => parseDataCardByTemplate('scenario', { title: '雾港' })).toThrow();
    expect(() => parseDataCardByTemplate('scenario', { title: '雾港', elements: '夜' })).toThrow();
    expect(() => parseDataCardByTemplate('scenario', { elements: {} })).toThrow();
  });

  it('通用情景卡把旧 name 字段归一化为 title', () => {
    const parsed = parseDataCardByTemplate('general-scenario', {
      templateId: '通用情景',
      name: '旧名情景',
      content: '设定',
    });
    expect(parsed.title).toBe('旧名情景');
    expect('name' in parsed).toBe(false);
  });

  it('arena_history 存在时 Canshou 的 entries 必填、MagicalGirl 的 entries 可缺省（迁移前各自语义）', () => {
    // 两类卡的 arena_history 形状共源，但 entries 必填性保持迁移前判定：
    // Canshou 的 `arena_history: {}` 旧实现拒绝；MagicalGirl 本就允许。
    expect(() => parseDataCardByTemplate('canshou', {
      name: '噬梦',
      arena_history: {},
    })).toThrow();
    expect(() => parseDataCardByTemplate('canshou', {
      name: '噬梦',
      arena_history: { entries: [{ title: '一战' }] },
    })).not.toThrow();
    expect(() => parseDataCardByTemplate('canshou', {
      name: '噬梦',
    })).not.toThrow();
    expect(() => parseDataCardByTemplate('magical-girl', {
      codename: '星光',
      arena_history: {},
    })).not.toThrow();
  });

  it('角色模板拒绝目标之外的顶层键（schema 门禁不是宽容透传）', () => {
    expect(() => parseDataCardByTemplate('magical-girl', {
      codename: '星光',
      elements: { scene: {} },
    })).toThrow();
    expect(() => parseDataCardByTemplate('canshou', {
      name: '噬梦',
      scenario_type: 'battle',
    })).toThrow();
  });

  it('转换实现与门禁的组合端到端：char↔scenario 双向产物均可通过目标 schema', () => {
    const toScenario = convertDataCard({ codename: '星光', appearance: { outfit: '白裙' } }, 'scenario');
    expect(() => parseDataCardByTemplate('scenario', toScenario.data)).not.toThrow();
    expect(toScenario.data.title).toBe('星光');

    const toMagicalGirl = convertDataCard({ title: '雾港', elements: { scene: { time: '夜' } } }, 'magical-girl');
    expect(() => parseDataCardByTemplate('magical-girl', toMagicalGirl.data)).not.toThrow();
    expect(toMagicalGirl.data.codename).toBe('雾港');

    const toGeneralScenario = convertDataCard({ codename: '星光' }, 'general-scenario');
    expect(() => parseDataCardByTemplate('general-scenario', toGeneralScenario.data)).not.toThrow();

    const toGeneral = convertDataCard({ title: '雾港', elements: {} }, 'general');
    expect(() => parseDataCardByTemplate('general', toGeneral.data)).not.toThrow();
  });
});
