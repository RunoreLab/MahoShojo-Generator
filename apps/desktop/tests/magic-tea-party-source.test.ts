import { describe, expect, it, vi } from 'vitest';
import { parseDesktopTeaRoles, parseDesktopTeaScenarios } from '../src/features/magic-tea-party/source';

const ids = () => { let serial = 0; return vi.fn(() => `tea-${++serial}`); };
const magical = {
  codename: '星光', templateId: '魔法少女/心之花/魔法少女（问卷生成）',
  appearance: { outfit: '蓝色裙装', future: { preserved: true } },
  magicConstruct: { name: '星匙', basicAbilities: ['飞行'], future: true },
  userAnswers: [{ question: '你相信什么？', answer: '朋友', questionId: 'q1', questionnaireId: 'legacy' }],
  current_state: { summary: '启程', fields: [], futureState: true },
  signature: 'source-signature', dataCardId: 'untrusted-cloud-id', _cardId: 'old-cloud-id',
  unknown: { imageUrl: 'https://media.invalid/card.png', script: 'do not execute' },
};
const general = { templateId: '通用角色', name: '旅人', content: '完整设定\n第二段', future: { preserve: true } };
const scenario = { title: '雾港', elements: { scene: { place: '港口', future: true }, events: '钟声', futureElements: [1, 2] }, metadata: { signature: 'source-signature', future: true }, future: 'keep' };

describe('Desktop tea local JSON card sources', () => {
  it('validates real questionnaire/native/general cards while preserving every original nested extension', () => {
    const canshou = { name: '影兽', coreConcept: '影', appearance: '黑雾', userAnswers: ['旧问卷答案'], unknown: true };
    const originals = [magical, canshou, general];
    const createId = ids();
    const roles = parseDesktopTeaRoles(JSON.stringify(originals), createId);
    expect(roles.map(role => role.id)).toEqual(['tea-1', 'tea-2', 'tea-3']);
    expect(roles.map(role => role.template)).toEqual(['magical-girl', 'canshou', 'general']);
    expect(roles.map(role => role.card)).toEqual(originals);
    expect(roles[0]).toMatchObject({ name: '星光', source: 'local', isNative: false });
    for (const role of roles) { expect(role.dataCardId).toBeUndefined(); expect(role.signature).toBeUndefined(); }
  });

  it('supports old questionnaire name-generation cards without inventing required modern fields', () => {
    const original = { codename: '旧角色', userAnswers: { q1: { question: '名字？', answer: '星光' } }, future: { keep: true } };
    expect(parseDesktopTeaRoles(JSON.stringify(original), ids())[0].card).toEqual(original);
  });

  it('normalizes Tavern v2 with the shared converter and keeps the complete original as inert _tavern.raw', () => {
    const raw = { spec: 'chara_card_v2', spec_version: '2.0', unknownRoot: true, data: {
      name: '酒馆角色', description: '第一段\n第二段', personality: '温柔', scenario: '茶馆', first_mes: '欢迎', mes_example: '例句',
      system_prompt: '角色设定', post_history_instructions: '保持口吻', alternate_greetings: ['开场一', '开场二'],
      character_book: { name: '世界书', entries: [{ content: '原始条目', unknown: true }] },
      avatar: 'https://media.invalid/avatar.png', extensions: { unknown: { script: 'inert', url: 'https://never.invalid' } },
    } };
    const [role] = parseDesktopTeaRoles(JSON.stringify(raw), ids());
    expect(role).toMatchObject({ id: 'tea-1', name: '酒馆角色', source: 'tavern', template: 'general', isNative: false });
    expect(role.card.content).toContain('第一段\n第二段');
    expect(role.card.content).toContain('欢迎');
    expect(role.card._tavern).toEqual({ raw });
    expect(role.avatarUrl).toBeUndefined(); expect(role.dataCardId).toBeUndefined(); expect(role.signature).toBeUndefined();
  });

  it('distinguishes legacy Tavern name+description from ordinary general card content', () => {
    expect(parseDesktopTeaRoles(JSON.stringify({ name: '旧酒馆', description: '完整正文', avatar: 'https://media.invalid/a.png' }), ids())[0].source).toBe('tavern');
    const ordinary = { ...general, description: '普通卡扩展' };
    expect(parseDesktopTeaRoles(JSON.stringify(ordinary), ids())[0]).toMatchObject({ source: 'local', card: ordinary });
  });

  it('preserves structured scenario extensions and adds a legacy general title without deleting name', () => {
    const legacy = { templateId: '通用情景', name: '旧情景名', content: '完整情景', extension: { imageUrl: 'https://media.invalid/scenario.png' } };
    const modern = { title: '无模板旧情景', content: '旧正文', extension: true };
    const scenarios = parseDesktopTeaScenarios(JSON.stringify([scenario, legacy, modern]), ids());
    expect(scenarios.map(item => item.card)).toEqual([scenario, { ...legacy, title: legacy.name }, modern]);
    expect(scenarios.map(item => item.title)).toEqual(['雾港', '旧情景名', '无模板旧情景']);
    expect(scenarios.every(item => item.source === 'local' && !item.isNative && !item.dataCardId && !item.signature)).toBe(true);
  });

  it('consumes historical scenario field shapes without applying the new-card editor schema', () => {
    const structured = {
      title: '旧雾港', elements: { scene: '港口的夜晚', events: ['钟声', { description: '启航' }], roles: { captain: '船长' } },
      metadata: { author: '作者', signature: 'unverified' }, _battle_story: { futureVersion: true, chapters: '旧格式' },
    };
    const generalScenario = {
      templateId: '通用情景', name: '旧故事', content: '完整情景',
      _battle_story: { futureVersion: true, chapters: '旧格式' },
    };
    const scenarios = parseDesktopTeaScenarios(JSON.stringify([structured, generalScenario]), ids());
    expect(scenarios.map(item => item.card)).toEqual([structured, { ...generalScenario, title: generalScenario.name }]);
    expect(scenarios.map(item => item.title)).toEqual(['旧雾港', '旧故事']);
    expect(scenarios.every(item => !item.isNative && !item.signature && !item.dataCardId)).toBe(true);
  });

  it.each([
    { title: '缺少结构或正文' },
    { title: '非法结构', elements: '场景' },
    { templateId: '通用情景', title: '非法正文', content: [] },
    { title: '  ', elements: {} },
  ])('preflights invalid scenarios after historical cards without allocating any identities: %j', invalid => {
    const createId = ids();
    const historical = { title: '旧情景', elements: { events: ['事件'] } };
    expect(() => parseDesktopTeaScenarios(JSON.stringify([historical, invalid]), createId)).toThrow();
    expect(createId).not.toHaveBeenCalled();
  });

  it('uses LocalCardRecordV1.data as payload and does not guess document envelopes', () => {
    const record = { schemaVersion: 1, storageLocation: 'local', cardType: 'character', id: 'local-old', data: general, cloudRef: { cardId: 'online' } };
    expect(parseDesktopTeaRoles(JSON.stringify(record.data), ids())[0].card).toEqual(general);
    expect(() => parseDesktopTeaRoles(JSON.stringify(record), ids())).toThrow('未识别到角色卡');
    expect(() => parseDesktopTeaRoles(JSON.stringify({ document: JSON.stringify(record) }), ids())).toThrow('未识别到角色卡');
  });

  it.each(['{', 'null', '[]', '[null]', '[1]', '"text"'])('rejects malformed or non-card input %s', text => {
    const createId = ids();
    expect(() => parseDesktopTeaRoles(text, createId)).toThrow();
    expect(createId).not.toHaveBeenCalled();
  });

  it('preflights every batch item before allocating identities, without partial results', () => {
    const createId = ids();
    expect(() => parseDesktopTeaRoles(JSON.stringify([general, { ...magical, appearance: 'invalid' }]), createId)).toThrow('已知字段格式');
    expect(createId).not.toHaveBeenCalled();
    expect(() => parseDesktopTeaScenarios(JSON.stringify([scenario, general]), createId)).toThrow('未识别到情景卡');
    expect(createId).not.toHaveBeenCalled();
  });

  it('does not use malformed explicit general cards as a Tavern fallback', () => {
    expect(() => parseDesktopTeaRoles(JSON.stringify({ templateId: '通用角色', name: 'broken', description: 'not content' }), ids())).toThrow('已知字段格式');
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects unsafe object key %s before inference', key => {
    const text = JSON.stringify(general).replace('"future":', `"${key}":`);
    expect(() => parseDesktopTeaRoles(text, ids())).toThrow('不安全');
  });

  it('retains paired Unicode and rejects isolated surrogate keys or values without replacement', () => {
    const safe = { ...general, content: '😀完整正文', future: { '🌙': '角色🫖' } };
    expect(parseDesktopTeaRoles(JSON.stringify(safe), ids())[0].card).toEqual(safe);
    expect(() => parseDesktopTeaRoles(JSON.stringify({ ...general, content: '\ud800' }), ids())).toThrow('Unicode');
    expect(() => parseDesktopTeaRoles(JSON.stringify({ ...general, future: { '\udfff': true } }), ids())).toThrow('Unicode');
  });

  it.each(['', 'invalid id', '中文', 'x'.repeat(129)])('requires host-generated Native-safe identity %s', id => {
    expect(() => parseDesktopTeaRoles(JSON.stringify(general), () => id)).toThrow('唯一有效');
  });

  it('rejects repeated generated IDs and oversized text with fixed errors that do not echo card data', () => {
    expect(() => parseDesktopTeaRoles(JSON.stringify([general, general]), () => 'same')).toThrow('唯一有效');
    expect(() => parseDesktopTeaRoles('x'.repeat(4 * 1024 * 1024 + 1), ids())).toThrow('4 MiB');
    const secretText = 'DO_NOT_ECHO_SECRET';
    expect(() => parseDesktopTeaRoles(JSON.stringify({ ...magical, appearance: secretText }), ids())).toThrow('数据卡的已知字段格式不正确，请保留原件并检查后重试。');
  });
});
