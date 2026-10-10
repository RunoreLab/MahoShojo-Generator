import { describe, expect, it } from 'vitest';
import { stripDerivedCharacterAuthority } from '../src/character-authority';
import { preserveSublimationCardExtensions } from '../src/sublimation';
import { projectArenaPostBattleCharacters } from '../src/arena-post-battle';
import { projectUnsignedArenaPostBattleCandidates } from '../src/arena-post-battle-candidates';
import { stripLegacySublimationAuthority } from './fixtures/legacy-sublimation-authority';

const claims = {
  signature: 'old', isNative: true, isPreset: true, isValid: true, isVerified: true,
  verificationStatus: 'verified', permissions: ['admin'], sourceDataCardId: 'cloud-id',
  sourceDataCardUpdatedAt: 'old', arenaRoomKey: 'room', adjudicationSourceKey: 'old',
  generation_id: 'old', generationId: 'old', base_revision_hash: 'old',
  created_at: 'old', updated_at: 'old', createdAt: 'old', updatedAt: 'old', generated_at: 'old', generatedAt: 'old',
};

describe('G4/Arena location-specific authority cleanup parity', () => {
  it.each([
    { ...claims, custom: { ...claims, templateId: 'user-extension' } },
    'legacy metadata', ['legacy', { ...claims }], null, undefined,
  ])('preserves the exact old G4 payload for metadata=%j through both real consumers', (metadata) => {
    const source = {
      ...claims, name: '角色甲', content: '角色设定', metadata,
      _custom: { ...claims }, unknownList: [{ ...claims }],
      arena_history: { attributes: { ...claims }, entries: [{ ...claims }] },
      current_state: { summary: '旧状态', ...claims },
    };
    const before = JSON.stringify(source);
    const expected = stripLegacySublimationAuthority(source);
    expect(stripDerivedCharacterAuthority(source)).toEqual(expected);
    // Exercise the production G4 consumer as well as the helper.
    expect(preserveSublimationCardExtensions({}, source, 'general', 'general')).toEqual(expected);
    const input = {
      combatants: [{ data: source }], report: {}, impacts: [{ characterName: '角色甲', currentStateSummary: '新状态' }],
      scenario: null, userGuidance: null, writeArenaHistory: false, writeCurrentState: true,
      writeNarrativeHistory: false, narrativeHistory: { title: '', content: '', entries: [] },
    };
    const context = {
      scopeKey: 'scope', requestId: 'request', generationId: 'request',
      occurredAt: '2026-10-09T10:00:00.000Z', worldLineIds: {},
    };
    const characterEffect = projectArenaPostBattleCharacters({ ...input, ...context }, {
      worldLineIds: {}, nonNativeDataInvolved: true,
    })[0]!;
    const candidate = projectUnsignedArenaPostBattleCandidates(input, context);
    expect(candidate.characterEffects[0]?.data).toEqual(stripLegacySublimationAuthority(characterEffect.data));
    expect(candidate.characterEffects[0]?.data._custom).toEqual(claims);
    expect(JSON.stringify(source)).toBe(before);
  });
});
