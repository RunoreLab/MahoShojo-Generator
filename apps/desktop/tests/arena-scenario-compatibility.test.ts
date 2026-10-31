import { describe, expect, it } from 'vitest';
import { buildArenaGenerationInputSnapshot } from '@mahoshojo/ai-core/arena-generation';
import { ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';
import { ArenaScenarioSchema } from '@mahoshojo/domain/arena-scenario';
import { parseArenaScenario } from '../src/features/arena/input';
import { applyArenaLibraryReferenceSelection } from '../src/features/arena/library-selection';
import { buildDesktopArenaInput, createInitialArenaDraft, validateArenaDraft } from '../src/features/arena/session';

const extended = {
  title: '旧情景', templateId: '自定义情景',
  elements: { scene: { place: '港口', custom: ['保留'] }, events: ['旧版数组'], custom: true },
  metadata: { signature: 'original-signature', author: '作者', custom: { keep: true } },
  extension: { custom: '完整保留' },
};

describe('Arena Web/Desktop scenario compatibility', () => {
  it.each([
    extended,
    { title: '数组情景', elements: [{ text: '旧版元素' }] },
    { title: '自由情景', elements: '自由文本' },
    { title: '无模板通用情景', content: '正文', name: '额外名字', extension: true },
    { title: '仅标题旧卡' },
  ])('accepts the Web consumption format without rewriting original fields: %j', card => {
    expect(parseArenaScenario(JSON.stringify(card))).toEqual(card);
    expect(ArenaScenarioSchema.parse(card)).toEqual(card);
  });

  it('normalizes the explicit legacy general name like Web', () => {
    expect(parseArenaScenario(JSON.stringify({ templateId: '通用情景', name: '旧名字', content: '正文', extension: true })))
      .toEqual({ templateId: '通用情景', title: '旧名字', content: '正文', extension: true });
  });

  it.each(['scenario', 'auxScenario'] as const)('preserves %s card-library originals through restore and generation projection', purpose => {
    const draft = applyArenaLibraryReferenceSelection({ ...createInitialArenaDraft(), battleMode: 'scenario', scenario: { content: { title: '主情景' }, fileName: null } }, purpose, true,
      { storageLocation: 'cloud', selectionId: 'cloud:card', cloudCardId: 'card', rawSourceData: extended },
      { advanced: true, createId: () => 'aux', onWarning: () => {} });
    const restored = validateArenaDraft(JSON.parse(JSON.stringify(draft)), 'arena');
    const input = buildDesktopArenaInput(restored, 'arena');
    expect(purpose === 'scenario' ? input.scenario.content : input.auxScenarios[0].content).toEqual(extended);
    const snapshot = buildArenaGenerationInputSnapshot(input);
    expect(purpose === 'scenario' ? snapshot.scenario : snapshot.auxScenarios?.[0]).toEqual(extended);
    expect(extended.metadata.signature).toBe('original-signature');
  });

  it.each([null, [], 1, { title: '' }, { title: 12 }, { name: '角色', content: '正文', templateId: '通用角色' }])('rejects non-scenario input %j', card => {
    expect(() => parseArenaScenario(JSON.stringify(card))).toThrow();
  });

  it('keeps the Desktop unsafe-key and raw byte admission gates', () => {
    expect(() => parseArenaScenario('{"title":"危险","constructor":{}}')).toThrow();
    expect(() => parseArenaScenario(JSON.stringify({ title: '超限', content: 'x'.repeat(ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes) }))).toThrow('12 MiB');
  });
});
