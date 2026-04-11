import type { ChallengeWorldId, ResourcePresentationPresetV1, WorldPresetV1 } from '@/lib/challenge/types';
import {
  arenaChallengeResourcePresentation,
  arenaChallengeWorldPreset,
} from '@/lib/challenge/worlds/arena/preset';

const WORLD_PRESETS: Record<ChallengeWorldId, WorldPresetV1> = {
  arena: arenaChallengeWorldPreset,
};

const RESOURCE_PRESENTATIONS: Record<string, ResourcePresentationPresetV1> = {
  [arenaChallengeResourcePresentation.id]: arenaChallengeResourcePresentation,
};

export const getChallengeWorldPreset = (worldId: ChallengeWorldId): WorldPresetV1 => {
  const preset = WORLD_PRESETS[worldId];
  if (!preset) {
    throw new Error(`CHALLENGE_WORLD_PRESET_NOT_FOUND:${worldId}`);
  }
  return preset;
};

export const getChallengeResourcePresentation = (presentationId: string): ResourcePresentationPresetV1 => {
  const presentation = RESOURCE_PRESENTATIONS[presentationId];
  if (!presentation) {
    throw new Error(`CHALLENGE_RESOURCE_PRESENTATION_NOT_FOUND:${presentationId}`);
  }
  return presentation;
};
