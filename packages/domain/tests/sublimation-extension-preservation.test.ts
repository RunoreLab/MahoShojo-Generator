import { describe, expect, it } from 'vitest';

import {
  assertSublimationCurrentStateWriteSupported,
  buildFinalSublimationData,
  convertSublimationCharacterCard,
  type BuildFinalSublimationDataInput,
} from '../src/sublimation';
import { buildStreamedSublimationResultCard } from '../src/sublimation-stream-result';

const source = () => ({
  templateId: '魔法少女/心之花/魔法少女（问卷生成）',
  codename: '白百合',
  appearance: { outfit: '旧外观', _palette: { colors: ['silver'], empty: null } },
  analysis: {
    predictionBasis: '旧推断',
    background: { belief: '旧信念', _campaign: { chapter: 3 } },
  },
  _custom: { templateId: 'user-extension-format', signature: 'story-handwriting', tags: ['月光'] },
  nullableExtension: null,
  metadata: {
    signature: 'old-metadata-signature',
    generation_id: 'old-generation',
    created_at: '2000-01-01',
    permissions: ['admin'],
    campaign: { season: 2 },
  },
  signature: 'old-signature',
  isNative: true,
  isPreset: true,
  isValid: true,
  verificationStatus: 'verified',
  permissions: ['admin'],
  createdAt: '2000-01-01',
  updated_at: '2000-01-02',
  sourceDataCardId: 'old-card',
  creationInputs: { template: 'magical-girl', buildRules: [], _authorNote: '保留' },
  buildState: { rules: [], _campaignVersion: 2 },
  adjudicationEvents: [{ description: '自定义事件', _custom: true }],
});

const finalizeInput = (original: Record<string, unknown>): BuildFinalSublimationDataInput => ({
  originalCharacterData: original,
  baseOutputData: convertSublimationCharacterCard(original, 'magical-girl').data,
  updatedDataFromAI: {
    codename: '白百合「晨曦」',
    appearance: { outfit: '新外观', _palette: { colors: ['ai-overwrite'] } },
    analysis: { predictionBasis: '新推断', background: { belief: '新信念' } },
    _custom: { tags: ['ai-overwrite'] },
    signature: 'forged-signature',
    isNative: true,
    metadata: { signature: 'forged-metadata-signature', generation_id: 'forged-generation' },
  },
  targetTemplate: 'magical-girl',
  allowReshapeNames: false,
  writeArenaHistory: false,
  writeCurrentState: false,
  arenaHistoryRetentionStrategy: 'keep-all',
  sublimationEvent: { title: '觉醒', impact: '成长' },
  finalUserGuidance: null,
  hasNarrativeHistory: false,
  hasQuestionnaireLore: false,
  hasNonNativeQuestionnaireLore: false,
  questionnaireSelectionCount: 0,
  isNative: false,
  nowISO: '2026-10-09T00:00:00.000Z',
});

const expectUnsigned = (result: Record<string, unknown>) => {
  for (const field of [
    'signature', 'isNative', 'isPreset', 'isValid', 'verificationStatus', 'permissions',
    'createdAt', 'updated_at', 'sourceDataCardId',
  ]) expect(result).not.toHaveProperty(field);
  expect(result.metadata).toEqual({ campaign: { season: 2 } });
};

describe('sublimation user extensions', () => {
  it('converts without reducing top-level/nested JSON extensions to generated prose', () => {
    const original = source();
    const before = JSON.stringify(original);
    const { data } = convertSublimationCharacterCard(original, 'magical-girl');
    expect(data._custom).toEqual(original._custom);
    expect(data._custom).not.toBe(original._custom);
    expect(data.nullableExtension).toBeNull();
    expect(data.appearance).toMatchObject(original.appearance);
    expect((data.analysis as Record<string, unknown>).background).toMatchObject(original.analysis.background);
    expectUnsigned(data);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('does not move the old card template marker into prose, while preserving opaque nested template IDs', () => {
    for (const target of ['magical-girl', 'canshou'] as const) {
      const { data } = convertSublimationCharacterCard({
        name: '旧角色', templateId: 'OLD-CARD-TEMPLATE-MARKER',
        _custom: { templateId: 'USER-EXTENSION-FORMAT' },
      }, target, 'canshou');
      expect(JSON.stringify(data)).not.toContain('OLD-CARD-TEMPLATE-MARKER');
      expect(data._custom).toEqual({ templateId: 'USER-EXTENSION-FORMAT' });
    }
  });

  it('finalizes new content while restoring opaque extensions and stripping model trust claims', () => {
    const original = source();
    const result = buildFinalSublimationData(finalizeInput(original));
    expect(result.codename).toBe('白百合「晨曦」');
    expect(result.appearance).toEqual({ outfit: '新外观', _palette: original.appearance._palette,
      accessories: '', colorScheme: '', overallLook: '' });
    expect(result.analysis).toMatchObject({
      predictionBasis: '新推断',
      background: { belief: '新信念', _campaign: { chapter: 3 } },
    });
    expect(result._custom).toEqual(original._custom);
    expect(result.nullableExtension).toBeNull();
    expectUnsigned(result);
    // Hosted runtime remains the only final signer, after this unsigned payload is built.
    result.signature = 'hosted-signature';
    expect(result.signature).toBe('hosted-signature');
  });

  it('uses the same explicit source template for conversion and finalization', () => {
    const original = { templateId: '通用角色', name: 'source', content: 'old', appearance: 'EXT' };
    const input: BuildFinalSublimationDataInput = {
      ...finalizeInput(source()),
      originalCharacterData: original,
      baseOutputData: convertSublimationCharacterCard(original, 'canshou', 'canshou').data,
      sourceTemplate: 'canshou',
      targetTemplate: 'canshou',
      updatedDataFromAI: { name: 'source「新称号」', appearance: '新外观' },
    };
    expect(buildFinalSublimationData(input)).toMatchObject({
      name: 'source「新称号」', appearance: '新外观',
    });
  });

  it('stream output keeps extensions and creator metadata, without restoring old content', () => {
    const original = source();
    const result = buildStreamedSublimationResultCard({
      markdown: '# 新角色\n\n新的完整正文',
      originalCharacterData: original,
      defaultName: '角色',
      writeArenaHistory: false,
      retentionStrategy: 'keep-all',
    });
    expect(result.content).toBe('# 新角色\n\n新的完整正文');
    expect(result.name).toBe('新角色');
    expect(result.appearance).toEqual({ _palette: original.appearance._palette });
    expect(result.analysis).toEqual({ background: { _campaign: { chapter: 3 } } });
    expect(result._custom).toEqual(original._custom);
    expect(result.nullableExtension).toBeNull();
    expect(result.creationInputs).toEqual(original.creationInputs);
    expect(result.buildState).toEqual(original.buildState);
    expect(result.adjudicationEvents).toEqual(original.adjudicationEvents);
    expectUnsigned(result);
  });

  it.each(['legacy metadata', ['legacy', { note: '保留原格式' }], null])(
    'does not silently drop an opaque legacy metadata shape: %j', (metadata) => {
      const result = buildStreamedSublimationResultCard({
        markdown: '# 新角色',
        originalCharacterData: { name: '旧角色', content: '旧正文', metadata },
        defaultName: '角色', writeArenaHistory: false, retentionStrategy: 'keep-all',
      });
      expect(result.metadata).toEqual(metadata);
    },
  );

  it('keeps opaque legacy metadata even when the source template is unknown', () => {
    const result = buildStreamedSublimationResultCard({
      markdown: '# 新角色', originalCharacterData: { metadata: ['legacy', null] },
      defaultName: '角色', writeArenaHistory: false, retentionStrategy: 'keep-all',
    });
    expect(result.metadata).toEqual(['legacy', null]);
  });

  it('rejects a cross-template extension collision rather than dropping data or replacing new content', () => {
    expect(() => convertSublimationCharacterCard(source(), 'canshou'))
      .toThrow(/appearance/);
  });

  it('writes only the new state summary/timestamp while preserving original fields and state extensions', () => {
    const original = {
      ...source(),
      current_state: {
        summary: '旧状态',
        fields: [{ id: 'hp', label: '体力', type: 'number', value: 20, _rule: 'hp-v2' }],
        updated_at: '2000-01-01',
        generation_id: 'old-generation',
        base_revision_hash: 'old-revision',
        isVerified: true,
        _campaign: { customState: ['night'] },
        metadata: { generation_id: 'old-generation', note: '持久扩展' },
      },
    };
    const input = finalizeInput(original);
    delete input.baseOutputData.current_state;
    input.writeCurrentState = true;
    input.updatedDataFromAI = { current_state: {
      summary: '新状态', fields: [], _campaign: { customState: ['ai-overwrite'] },
      generation_id: 'forged-generation', base_revision_hash: 'forged-revision', signature: 'forged-signature',
    } };
    const result = buildFinalSublimationData(input);
    expect(result.current_state).toEqual({
      summary: '新状态', fields: original.current_state.fields,
      updated_at: input.nowISO, _campaign: original.current_state._campaign,
      metadata: { note: '持久扩展' },
    });
  });

  it.each(['legacy state', [], { fields: { hp: 30 } }, { fields: null }].map((current_state) => ({ current_state })))(
    'rejects unsupported legacy state only when writing is enabled: $current_state', ({ current_state }) => {
      expect(() => assertSublimationCurrentStateWriteSupported(current_state)).toThrow(/当前状态/);
      const input = finalizeInput({ ...source(), current_state });
      input.writeCurrentState = true;
      expect(() => buildFinalSublimationData(input)).toThrow(/当前状态/);
      input.writeCurrentState = false;
      expect(buildFinalSublimationData(input).current_state).toEqual(current_state);
    },
  );

  it.each([null, undefined, {}, { fields: [] }, { fields: ['legacy entry', null, { _custom: true }] }])(
    'accepts missing state and preserves array entries without reshaping them: %j', (current_state) => {
      expect(() => assertSublimationCurrentStateWriteSupported(current_state)).not.toThrow();
      const input = finalizeInput({ ...source(), current_state });
      input.writeCurrentState = true;
      input.updatedDataFromAI = { current_state: { summary: '新状态' } };
      const result = buildFinalSublimationData(input);
      expect(result.current_state).toMatchObject({
        summary: '新状态',
        fields: current_state?.fields ?? [],
        updated_at: input.nowISO,
      });
    },
  );

  it('preserves known source fields only as extension subtrees when converting to general', () => {
    const result = convertSublimationCharacterCard(source(), 'general').data;
    expect(result.appearance).toEqual({ _palette: source().appearance._palette });
    expect(result.analysis).toEqual({ background: { _campaign: { chapter: 3 } } });
    expectUnsigned(result);
  });
});
