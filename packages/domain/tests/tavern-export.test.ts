import { describe, expect, it } from 'vitest';
import {
  buildArenaDefaultScenario, buildCreatorField, buildCreatorNotesWithCloudDescription,
  buildDefaultFieldsFromDataCard, buildExportExtensions, buildSourceDataSnapshot, buildTavernExportCard,
  buildTavernScenarioFragment, DEFAULT_CREATOR_NOTES, DEFAULT_TAVERN_CREATOR, getPlaceholderPngBytes,
  initialFields, parseTavernExportTags, readTavernLocalDocument, TAVERN_SOURCE_SNAPSHOT_MAX_CHARS,
  MAX_TAVERN_TEXT_BYTES,
  writeTavernCardToPngBytes, type ExportFields, type ExportMeta, type TavernCharacterBook, type TavernScenarioFragment,
} from '../src/tavern-card';

const exportedAt = '2026-10-09T12:00:00.000Z';
const general = { templateId: '通用角色', name: '旅人', content: '完整的通用角色正文' };
const build = (fields: Partial<ExportFields> = {}) => buildTavernExportCard({ fields: { ...initialFields, ...fields }, dataCard: general, exportedAt });
const book = (result: ReturnType<typeof build>) => result.card.data.character_book as TavernCharacterBook;
const metadata = (result: ReturnType<typeof build>) => result.card.data.extensions?.ms_export as ReturnType<typeof buildExportExtensions>['ms_export'];
const fragments: TavernScenarioFragment[] = [
  { kind: 'general-scenario', title: '第一幕', content: '第一幕正文', warnings: [] },
  { kind: 'scenario', title: '第二幕', content: '第二幕正文', warnings: [] },
];

describe('Tavern export field projection', () => {
  it('retains magical-girl sections, metadata precedence and questionnaire dialogue', () => {
    const source = {
      codename: '萤火', appearance: { overallLook: '银发', outfit: '长裙', accessories: '发夹', colorScheme: '蓝白' },
      analysis: { personalityAnalysis: '温柔', abilityReasoning: '未映射的分析' },
      magicConstruct: { name: '星杖', form: '法杖', basicAbilities: ['光', ' 治愈 ', 123], description: '星光所化' },
      wonderlandRule: { name: '光庭', tendency: '守护', activation: '月升', description: '光照之地' },
      blooming: { name: '破晓', powerLevel: '强', evolvedForm: '天使', evolvedOutfit: '羽衣', evolvedAbilities: ['飞翔'] },
      userAnswers: [{ question: '1. 你是谁？', answer: '1. 我叫萤火。' }],
      _tavern: { meta: { name: '酒馆名', personality: '不覆盖分析', scenario: '初始场景', tags: ['旧标签'] } },
    };
    const fields = buildDefaultFieldsFromDataCard('magical-girl', source);
    expect(fields).toMatchObject({ name: '酒馆名',
      description: '【外观】\n银发\n服装：长裙\n饰品：发夹\n配色：蓝白\n\n【魔装】\n名称：星杖\n形态：法杖\n能力：光、治愈\n星光所化\n\n【奇境规则】\n名称：光庭\n倾向：守护\n触发：月升\n光照之地\n\n【繁开】\n名称：破晓\n强度：强\n形态：天使\n装束：羽衣\n能力：飞翔',
      personality: '温柔', scenario: '初始场景', firstMes: '我叫萤火。', mesExample: '{{user}}: 你是谁？\n{{char}}: 我叫萤火。',
      creator: DEFAULT_TAVERN_CREATOR, creatorNotes: DEFAULT_CREATOR_NOTES });
    expect(fields.tags.split(', ')).toEqual(expect.arrayContaining(['旧标签', '魔法少女', '星杖', '光庭', '破晓']));
    expect(buildDefaultFieldsFromDataCard('magical-girl', { ...source,
      _tavern: { meta: { description: '手写说明', first_mes: '手写开场', mes_example: '手写对话' } },
    })).toMatchObject({ description: '手写说明', firstMes: '手写开场', mesExample: '手写对话' });
  });

  it('retains canshou mapping without inventing a greeting', () => {
    const fields = buildDefaultFieldsFromDataCard('canshou', { name: '暗兽', appearance: '烟雾', materialAndSkin: '鳞片',
      featuresAndAppendages: '长尾', evolutionStage: '成熟', attackMethod: '撕咬', specialAbility: '影遁', coreEmotion: '悲伤',
      origin: '不映射到描述', _tavern: { meta: { personality: '不覆盖核心情绪' } } });
    expect(fields).toMatchObject({ name: '暗兽',
      description: '【外观】\n烟雾\n\n【材质与皮肤】\n鳞片\n\n【特征与附肢】\n长尾\n\n【进化阶段】\n成熟\n\n【攻击方式】\n撕咬\n\n【特殊能力】\n影遁',
      personality: '悲伤', firstMes: '', mesExample: '' });
    expect(fields.tags).toContain('残兽');
  });

  it('retains general name precedence and both legacy metadata spellings', () => {
    const fields = buildDefaultFieldsFromDataCard('general', { ...general, _tavern: { meta: {
      name: '不覆盖通用名称', description: '替代描述', personality: '直率', scenario: '酒馆', firstMes: '你好',
      first_mes: '旧值', mes_example: '问答', creator_notes: '旧备注', creator: '原作者',
    } } }, null, ' 指定作者 ');
    expect(fields).toEqual({ ...initialFields, name: '旅人', description: '替代描述', personality: '直率', scenario: '酒馆',
      firstMes: '你好', mesExample: '问答', creatorNotes: '旧备注', creator: '指定作者', tags: 'MahoShojo-Generator, 其他角色卡' });
  });

  it('returns independent defaults for invalid input and accepts unknown templates', () => {
    const fields = buildDefaultFieldsFromDataCard('unknown', null);
    expect(fields).toEqual(initialFields); expect(fields).not.toBe(initialFields);
    expect(buildDefaultFieldsFromDataCard('unknown', { codename: '未分类', description: '原描述' })).toMatchObject({ name: '未分类', description: '原描述' });
  });

  it('retains creator de-duplication and the separate 800-character cloud-description cap', () => {
    expect(buildCreatorNotesWithCloudDescription({ _cardId: 'id', _cardDescription: '角色数据卡' }, '备注')).toBe('备注');
    expect(buildCreatorNotesWithCloudDescription({ _cardDescription: '无云ID' }, '备注')).toBe('备注');
    const card = { dataCardId: 'id', _cardDescription: '简介'.repeat(500) };
    const note = buildCreatorNotesWithCloudDescription(card, '备注');
    expect(note).toBe(`备注\n\n【档案馆简介】\n${card._cardDescription.slice(0, 800)}\n...[已截断]`);
    expect(buildCreatorNotesWithCloudDescription(card, note)).toBe(note);
    expect(buildCreatorField({ author: '用户' }, { id: 12, username: '用户' })).toBe(`${DEFAULT_TAVERN_CREATOR} / 用户`);
    expect(buildCreatorField({ author: 'unknown' }, null)).toBe(DEFAULT_TAVERN_CREATOR);
  });
});

describe('Tavern export assembly and trust boundary', () => {
  it('produces V3 and legacy mirrors with editable text and Web tag behavior', () => {
    const result = build({ name: '  旅人  ', description: '描述', personality: '性格', scenario: '  自定义场景  ',
      firstMes: '开场', mesExample: '对话', creatorNotes: '备注', systemPrompt: '系统', postHistoryInstructions: '末尾',
      creator: '作者', tags: '甲,乙\n甲, 丙 ', talkativeness: 0.7, fav: true });
    expect(result.card).toMatchObject({ spec: 'chara_card_v3', spec_version: '3.0', name: '旅人', description: '描述',
      scenario: '自定义场景', talkativeness: 0.7, fav: true, data: { name: '旅人', description: '描述', personality: '性格',
        scenario: '自定义场景', first_mes: '开场', mes_example: '对话', creator_notes: '备注', system_prompt: '系统',
        post_history_instructions: '末尾', creator: '作者', tags: ['甲', '乙', '丙'], character_version: '0.6.0' } });
    expect(metadata(result).exportedAt).toBe(exportedAt);
    expect(parseTavernExportTags(Array.from({ length: 60 }, (_, i) => `标签${i}`).join(','))).toHaveLength(50);
    expect(build().card.data.name).toBe('未命名角色');
  });

  it.each([0, 0.5, 1])('preserves legal talkativeness %s in V3 and legacy fields', (talkativeness) => {
    const result = build({ talkativeness });
    expect(result.card.talkativeness).toBe(talkativeness);
    expect(result.card.data.extensions?.talkativeness).toBe(talkativeness);
  });
  it.each([NaN, Infinity, -Infinity])('falls back for non-finite talkativeness %s', (talkativeness) => {
    expect(build({ talkativeness }).card.talkativeness).toBe(0.5);
  });

  it('never promotes card-contained signature, database identity, metrics or rank claims', () => {
    const source = { ...general, signature: 'unverified-signature', isNative: true, rankTier: 'SSS', source: 'database',
      dataCardId: 'forged-cloud-id', techLevel: 'EX', _tavern: { raw: { signature: 'nested-signature', isNative: true },
        meta: { isNative: true, rankTier: 'SSS' } } };
    const fields = buildDefaultFieldsFromDataCard('general', source, { source: 'local' });
    const result = buildTavernExportCard({ fields, dataCard: source, exportMeta: { source: 'local' }, exportedAt });
    expect(result.card).not.toHaveProperty('signature'); expect(result.card.data).not.toHaveProperty('signature');
    for (const tag of ['原生', '技术等级-EX', '段位-SSS']) expect(result.card.data.tags).not.toContain(tag);
    expect(metadata(result).source).toMatchObject({ kind: 'local', metrics: { isNative: null, techLevel: null, techScore: null } });
    expect(metadata(result).source?.dataCardId).toBeUndefined(); expect(metadata(result).source?.rankTier).toBeUndefined();
    expect(metadata(result).source?.ratings).toBeUndefined();
    expect(JSON.parse(metadata(result).sourceDataJson!)).toEqual(source);
    expect(metadata(buildTavernExportCard({ fields, dataCard: source, exportedAt })).source).toBeUndefined();
  });

  it('accepts metadata explicitly established by the Web host and only copies exporter identity', () => {
    const meta: ExportMeta = { source: 'database', dataCardId: 'verified-id', dataCardName: '档案馆名称', author: '作者',
      isNative: true, techLevel: 'L3', techScore: 42, rankTier: '黄金', tags: ['官方标签', '官方标签'],
      ratings: { strict: null, free: null }, likeCount: 3 };
    const fields = buildDefaultFieldsFromDataCard('general', general, meta);
    const exporter = { id: 7, username: '导出者', privateValue: 'not copied' };
    const result = buildTavernExportCard({ fields, dataCard: general, exportMeta: meta, exporter, exportedAt });
    expect(result.card.data.tags).toEqual(expect.arrayContaining(['官方标签', '原生', '技术等级-L3', '段位-黄金']));
    expect(metadata(result)).toMatchObject({ exporter: { id: 7, username: '导出者' }, source: {
      kind: 'database', dataCardId: 'verified-id', name: '档案馆名称', author: '作者', metrics: { isNative: true, techLevel: 'L3', techScore: 42 },
      tags: ['官方标签'], stats: { likeCount: 3 }, rankTier: '黄金', ratings: { strict: null, free: null } } });
    expect(metadata(result).exporter).not.toHaveProperty('privateValue');
  });

  it('preserves unknown source data inertly and reports that field projection is lossy', () => {
    const source = { ...general, future: { nested: [1, false, '未知字段', null] }, signature: 'a claim only' };
    const original = JSON.stringify(source);
    const result = buildTavernExportCard({ fields: buildDefaultFieldsFromDataCard('general', source), dataCard: source, exportedAt });
    expect(result.card.data).not.toHaveProperty('future'); expect(JSON.parse(metadata(result).sourceDataJson!)).toEqual(source);
    expect(JSON.stringify(source)).toBe(original); expect(result.warnings.join('')).toContain('未映射字段');
    expect(result.warnings.join('')).toContain('另存源 JSON');
    expect(result.sourceSnapshot).toEqual({ included: true, available: true, truncated: false, maxChars: 24_000 });
  });

  it('is deterministic and survives a real PNG round trip', () => {
    const fields = Object.freeze(buildDefaultFieldsFromDataCard('general', general));
    const input = { fields, dataCard: Object.freeze({ ...general }), scenarioFragments: Object.freeze([...fragments]), exportedAt };
    const first = buildTavernExportCard(input); expect(buildTavernExportCard(input)).toEqual(first);
    const bytes = writeTavernCardToPngBytes(getPlaceholderPngBytes(), first.card);
    expect(readTavernLocalDocument(bytes, 'png').candidates[0].parsed).toEqual(JSON.parse(JSON.stringify(first.card)));
  });

  it('accepts final JSON just under 4 MiB, round-trips both PNG chunks, and rejects a one-character overflow', () => {
    const options = { autoArenaScenario: false, includeArenaWorldbook: false, includeScenarioInScenario: false,
      includeScenarioInWorldbook: false, includeSourceSnapshot: false };
    const input = { fields: { ...initialFields, name: 'n' }, dataCard: null, options, exportedAt };
    const overhead = new TextEncoder().encode(JSON.stringify(buildTavernExportCard(input).card)).length;
    // description is present in both data.description and the legacy root mirror.
    const description = 'a'.repeat(Math.floor((MAX_TAVERN_TEXT_BYTES - overhead) / 2));
    const accepted = buildTavernExportCard({ ...input, fields: { ...input.fields, description } });
    const bytes = new TextEncoder().encode(JSON.stringify(accepted.card)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_TAVERN_TEXT_BYTES);
    expect(MAX_TAVERN_TEXT_BYTES - bytes).toBeLessThan(2);
    const png = writeTavernCardToPngBytes(getPlaceholderPngBytes(), accepted.card);
    expect(readTavernLocalDocument(png, 'png').candidates[0].parsed).toEqual(accepted.card);
    expect(() => buildTavernExportCard({ ...input, fields: { ...input.fields, description: `${description}a` } })).toThrow('4 MiB');
  });

  it('counts UTF-8 bytes of the assembled output rather than source character length', () => {
    const description = '文'.repeat(750_000);
    expect(description.length).toBeLessThan(MAX_TAVERN_TEXT_BYTES);
    expect(() => build({ description })).toThrow('4 MiB');
  });

  it('rejects unsafe keys in final metadata while raw source-JSON strings remain inert', () => {
    const exportMeta = { source: 'database', ratings: { strict: { constructor: 'unsafe' }, free: null } } as unknown as ExportMeta;
    expect(() => buildTavernExportCard({ fields: { ...initialFields }, dataCard: general, exportMeta, exportedAt })).toThrow('安全有效');
    const source = JSON.parse('{"name":"source","constructor":"inert original claim"}');
    expect(() => buildTavernExportCard({ fields: { ...initialFields }, dataCard: source, exportedAt })).not.toThrow();
  });
});

describe('Tavern scenario and worldbook options', () => {
  it('defaults to arena scenario and lore, preserving fragment order in both destinations', () => {
    const result = buildTavernExportCard({ fields: { ...initialFields }, dataCard: general, scenarioFragments: fragments, exportedAt });
    expect(result.card.data.scenario).toBe([buildArenaDefaultScenario(), '第一幕正文', '第二幕正文'].join('\n\n---\n\n'));
    expect(book(result).entries[0].comment).toBe('A.R.E.N.A. 总览');
    expect(book(result).entries.slice(-2).map((entry) => entry.content)).toEqual(['第一幕正文', '第二幕正文']);
  });

  it.each([false, true].flatMap((includeScenarioInScenario) => [false, true].flatMap((includeScenarioInWorldbook) =>
    [false, true].map((includeArenaWorldbook) => ({ includeScenarioInScenario, includeScenarioInWorldbook, includeArenaWorldbook }))
  )))('keeps scenario and worldbook switches independent: %j', (options) => {
    const result = buildTavernExportCard({ fields: { ...initialFields, scenario: '  自定义  ' }, dataCard: general,
      scenarioFragments: fragments, options: { ...options, autoArenaScenario: false }, exportedAt });
    expect(result.card.data.scenario).toBe(options.includeScenarioInScenario ? '自定义\n\n---\n\n第一幕正文\n\n---\n\n第二幕正文' : '自定义');
    expect(book(result).entries.some((entry) => entry.comment === 'A.R.E.N.A. 总览')).toBe(options.includeArenaWorldbook);
    expect(book(result).entries.some((entry) => entry.comment === '附加情景：第一幕')).toBe(options.includeScenarioInWorldbook);
  });

  it('supports an empty scenario and book when defaults are disabled', () => {
    const result = buildTavernExportCard({ fields: { ...initialFields }, dataCard: general, options: { autoArenaScenario: false,
      includeArenaWorldbook: false, includeScenarioInScenario: false, includeScenarioInWorldbook: false }, exportedAt });
    expect(result.card.data.scenario).toBe(''); expect(book(result)).toEqual({ name: '', entries: [] });
  });

  it('reports the existing 6k worldbook cap and earlier fragment warnings without limiting scene text', () => {
    const long = { kind: 'scenario' as const, title: '长情景', content: '幕'.repeat(7_000), warnings: ['上游片段提示'] };
    const result = buildTavernExportCard({ fields: { ...initialFields }, dataCard: general, scenarioFragments: [long], exportedAt });
    expect(result.card.data.scenario).toContain(long.content);
    expect(book(result).entries.at(-1)?.content).toBe(`${'幕'.repeat(6_000)}\n...[已截断]`);
    expect(result.warnings).toContain('上游片段提示'); expect(result.warnings.join('')).toContain('世界书条目已截断到 6000');
    const excluded = buildTavernExportCard({ fields: { ...initialFields }, dataCard: general, scenarioFragments: [long],
      options: { includeScenarioInScenario: false, includeScenarioInWorldbook: false }, exportedAt });
    expect(excluded.warnings.join('')).not.toContain('上游片段提示');
    expect(excluded.warnings.join('')).not.toContain('世界书条目已截断');
  });

  it('surfaces upstream scenario-fragment truncation', () => {
    const fragment = buildTavernScenarioFragment({ templateId: '通用情景', title: '片段', content: '字'.repeat(100) }, { maxChars: 20 })!;
    const result = buildTavernExportCard({ fields: { ...initialFields }, dataCard: general, scenarioFragments: [fragment], exportedAt });
    expect(result.warnings).toEqual(expect.arrayContaining(fragment.warnings));
    expect(result.card.data.scenario).toContain(fragment.content);
  });
});

describe('optional source diagnostic snapshot', () => {
  it('caps only the 24k snapshot, preserving main description and complete original source JSON', () => {
    const source = { ...general, content: '完整正文'.repeat(7_000), unknown: { tail: '完整源字段' } };
    const sourceJson = JSON.stringify(source); const fields = buildDefaultFieldsFromDataCard('general', source);
    const result = buildTavernExportCard({ fields, dataCard: source, exportedAt });
    expect(result.card.data.description).toBe(source.content); expect(result.card.description).toBe(source.content);
    expect(metadata(result).sourceDataJson).toBe(`${sourceJson.slice(0, TAVERN_SOURCE_SNAPSHOT_MAX_CHARS)}\n...[已截断]`);
    expect(metadata(result).sourceDataTruncated).toBe(true);
    expect(result.sourceSnapshot).toMatchObject({ included: true, available: true, truncated: true });
    expect(result.warnings.join('')).toContain('不能用于完整恢复源数据');
    expect(JSON.parse(JSON.stringify(source)).unknown).toEqual({ tail: '完整源字段' });
  });

  it('omits the optional snapshot without changing roleplay fields', () => {
    const fields = buildDefaultFieldsFromDataCard('general', general);
    const result = buildTavernExportCard({ fields, dataCard: general, options: { includeSourceSnapshot: false }, exportedAt });
    expect(result.card.data.description).toBe(general.content); expect(JSON.stringify(metadata(result))).not.toContain('sourceDataJson');
    expect(result.sourceSnapshot).toEqual({ included: false, available: false, truncated: false, maxChars: 24_000 });
    expect(result.warnings.join('')).not.toContain('无法序列化');
  });

  it('reports serialization failure while preserving edited fields', () => {
    const cyclic: Record<string, unknown> = { name: '循环' }; cyclic.self = cyclic;
    expect(buildSourceDataSnapshot(cyclic, 24_000)).toBeNull();
    const result = buildTavernExportCard({ fields: { ...initialFields, description: '编辑后正文' }, dataCard: cyclic, exportedAt });
    expect(result.card.data.description).toBe('编辑后正文');
    expect(result.sourceSnapshot).toMatchObject({ included: true, available: false, truncated: false });
    expect(result.warnings.join('')).toContain('无法序列化'); expect(() => JSON.stringify(result.card)).not.toThrow();
  });

  it('retains the exact snapshot truncation boundary', () => {
    expect(buildSourceDataSnapshot('abc', 5)).toEqual({ json: '"abc"', truncated: false });
    expect(buildSourceDataSnapshot('abc', 4)).toEqual({ json: '"abc\n...[已截断]', truncated: true });
  });
});
