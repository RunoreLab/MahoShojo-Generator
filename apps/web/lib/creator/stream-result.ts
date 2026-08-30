import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
} from '@/lib/stream/markdown-card';

import { buildPersistedCreationInputs } from './card-metadata';
import type { CreatorStreamTemplateId } from './templates';

type BuildCreatorStreamCardInput = {
  template: CreatorStreamTemplateId;
  markdown: string;
  fallbackLabel?: string | null;
  creationInputs?: Record<string, unknown>;
  buildState?: Record<string, unknown>;
};

type FinalizeCreatorStreamCardInput = BuildCreatorStreamCardInput & {
  creationInputs: Record<string, unknown>;
  buildState?: Record<string, unknown>;
  userAnswers?: unknown;
};

export function buildCreatorStreamCardFromMarkdown({
  template,
  markdown,
  fallbackLabel,
  creationInputs,
  buildState,
}: BuildCreatorStreamCardInput) {
  const creatorMetadata = {
    ...(typeof creationInputs === 'undefined' ? {} : { creationInputs: buildPersistedCreationInputs(creationInputs) }),
    ...(typeof buildState === 'undefined' ? {} : { buildState }),
  };

  if (template === 'general-scenario') {
    return {
      ...buildGeneralScenarioCardFromMarkdown({
        markdown,
        fallbackTitle: fallbackLabel,
        defaultTitle: '情景',
      }).card,
      ...creatorMetadata,
    };
  }

  return {
    ...buildGeneralCharacterCardFromMarkdown({
      markdown,
      fallbackName: fallbackLabel,
      defaultName: '角色',
    }).card,
    ...creatorMetadata,
  };
}

export function finalizeCreatorStreamCard({
  template,
  markdown,
  fallbackLabel,
  creationInputs,
  buildState,
  userAnswers,
}: FinalizeCreatorStreamCardInput) {
  return {
    ...buildCreatorStreamCardFromMarkdown({
      template,
      markdown,
      fallbackLabel,
      creationInputs,
      buildState,
    }),
    ...(typeof userAnswers === 'undefined' ? {} : { userAnswers }),
  };
}
