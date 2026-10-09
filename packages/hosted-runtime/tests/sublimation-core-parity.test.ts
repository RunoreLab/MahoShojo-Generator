import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSublimationGenerationConfig, buildSublimationStreamConfig } from '../src/sublimation-runtime-shared';
import { createSublimationGenerationCore, buildSublimationStreamCore } from '@mahoshojo/ai-core/sublimation-generation';

const originalData = { name: '雾灯', codename: '星灯', content: '完整设定', signature: 'do-not-send',
  userAnswers: ['回答'], current_state: { summary: '疲惫', fields: [{ label: '力量', type: 'number', value: 4 }] },
  arena_history: { entries: [{ id: 'legacy', title: '初遇', impact: '成长', winner: '星灯', future: true }] },
  future_extension: { lore: '保留数据' } };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Schema hashes retain the 99e3906 baseline; prompt hashes include the 2026-10-09
// intentional readable-input, preservation and technical-metadata prompt revisions.
describe('Sublimation 生成核迁移与 Hosted 行为保真', () => {
  for (const targetTemplate of ['general', 'magical-girl', 'canshou'] as const)
    for (const enabled of [true, false])
      for (const preserve of [true, false])
        it(`${targetTemplate}: state=${enabled}, preserve=${preserve}`, () => {
          const input = { originalData, baseOutputData: { ...originalData, newField: '差异' }, language: 'pt-BR',
            userGuidance: '成长', narrativeHistory: '叙事', loreText: '参考', sourceTemplate: 'general' as const, targetTemplate,
            fieldsToPreserve: preserve ? ['name', 'codename', 'future_extension', 'current_state'] : [],
            allowReshapeNames: enabled, isDowngrade: !enabled, defaultQuestions: { magicalGirl: ['问题'], canshou: ['残兽问题'] },
            stateOptions: { readArenaHistory: enabled, writeArenaHistory: enabled, readCurrentState: enabled, writeCurrentState: enabled } };
          const snapshot = structuredClone(input);
          const hosted = createSublimationGenerationConfig(input);
          const core = createSublimationGenerationCore(input);
          expect(core.promptBuilder()).toBe(hosted.promptBuilder(null));
          expect(hash(hosted.promptBuilder(null))).toMatchSnapshot('structured-prompt');
          expect(hosted.modelOverride).toBe(enabled ? undefined : 'gemini-2.5-flash-lite');
          expect(core).not.toHaveProperty('modelOverride');
          for (const value of [null, {}, { updatedCharacterData: {}, sublimationEvent: { title: '成长', impact: '新经历' } },
            { updatedCharacterData: { name: '雾灯「新生」', content: '完整新设定', future_extension: { lore: 'x' } }, sublimationEvent: { title: '成长', impact: '新经历' } }]) {
            expect(hash(JSON.stringify(hosted.schema.safeParse(value)))).toMatchSnapshot('schema-result');
          }
          // Legacy stream callers did not declare state read controls.
          const streamInput = { ...input, stateOptions: undefined, modelOverride: 'custom-model' };
          const stream = buildSublimationStreamConfig(streamInput);
          expect(stream.modelOverride).toBe('custom-model');
          expect(buildSublimationStreamCore(streamInput).prompt).toBe(stream.prompt);
          expect(hash(stream.prompt)).toMatchSnapshot('stream-prompt');
          expect(input).toEqual(snapshot);
        });
});

it('Hosted 路由保持空模型与显式覆盖语义，纯核不携带 provider 上下文', () => {
  const input = { originalData, baseOutputData: originalData, language: 'zh-CN', userGuidance: '', narrativeHistory: '', loreText: '',
    sourceTemplate: 'general' as const, targetTemplate: 'general' as const, fieldsToPreserve: [], allowReshapeNames: false,
    defaultQuestions: { magicalGirl: [], canshou: [] },
    stateOptions: { readArenaHistory: false, writeArenaHistory: false, readCurrentState: false, writeCurrentState: false } };
  for (const isDowngrade of [true, false]) for (const modelOverride of [undefined, '', 'custom-model']) {
    const config = createSublimationGenerationConfig({ ...input, isDowngrade, modelOverride });
    expect(config.modelOverride).toBe(modelOverride === '' ? undefined : modelOverride ?? (isDowngrade ? 'gemini-2.5-flash-lite' : undefined));
    const stream = buildSublimationStreamConfig({ ...input, isDowngrade, modelOverride });
    expect(stream.modelOverride).toBe(modelOverride || undefined);
  }
  const core = createSublimationGenerationCore(input);
  expect(Object.keys(core).sort()).toEqual(['promptBuilder', 'schema', 'systemPrompt', 'taskName', 'temperature']);
  expect(Object.keys(buildSublimationStreamCore({ ...input, isDowngrade: false })).sort()).toEqual(['prompt', 'temperature']);
});
