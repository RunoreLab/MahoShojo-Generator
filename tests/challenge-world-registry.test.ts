import { describe, expect, test } from 'bun:test';

import {
  getChallengeResourcePresentation,
  getChallengeWorldPreset,
} from '@/lib/challenge/world-registry';

describe('challenge world registry', () => {
  test('arena preset 暴露资源模型与 resource presentation', () => {
    const preset = getChallengeWorldPreset('arena');
    const presentation = getChallengeResourcePresentation(preset.resourcePresentationId);

    expect(preset.id).toBe('arena');
    expect(preset.resourceModelId).toBe('arena-v1');
    expect(preset.resourcePresentationId).toBe('arena-v1');
    expect(presentation.primaryTracks.map((item) => item.trackId)).toEqual(['hp', 'radiance', 'currency']);
    expect(presentation.secondaryCollections).toEqual([
      { key: 'persistentItemIds', label: '奇物', displayMode: 'chips' },
      { key: 'consumableIds', label: '消耗品', displayMode: 'chips' },
      { key: 'temporaryStatuses', label: '状态', displayMode: 'chips' },
    ]);
  });
});
