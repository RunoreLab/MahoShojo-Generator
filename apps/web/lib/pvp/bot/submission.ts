import { buildBotSubmissionPayload as buildSharedSubmission } from '@mahoshojo/hosted-runtime/admin/arena-submission';
import { getRandomPublicCard } from '@/lib/database/data-cards';
import { loadPresetCard } from '@/lib/pvp/preset';
import { BUNDLED_PRESET_FILENAMES } from '@/lib/pvp/preset-bundled';
import type { PvpRoomRules, PvpSubmissionPayload } from '@/lib/pvp/types';

export function buildBotSubmissionPayload(options: {
  rules: Pick<PvpRoomRules, 'cardsPerPlayer' | 'cardRange'>;
  origin: string;
  forwardHeaders?: HeadersInit;
  excludeRefKeys?: Set<string>;
  rng?: () => number;
}): Promise<PvpSubmissionPayload> {
  return buildSharedSubmission({ getRandomPublicCard, loadPresetCard, presetFilenames: BUNDLED_PRESET_FILENAMES }, options);
}
