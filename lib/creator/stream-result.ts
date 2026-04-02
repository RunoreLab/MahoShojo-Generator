import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
} from '@/lib/stream/markdown-card';

import type { CreatorStreamTemplateId } from './templates';

type BuildCreatorStreamCardInput = {
  template: CreatorStreamTemplateId;
  markdown: string;
  fallbackLabel?: string | null;
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
}: BuildCreatorStreamCardInput) {
  if (template === 'general-scenario') {
    return buildGeneralScenarioCardFromMarkdown({
      markdown,
      fallbackTitle: fallbackLabel,
      defaultTitle: '情景',
    }).card;
  }

  return buildGeneralCharacterCardFromMarkdown({
    markdown,
    fallbackName: fallbackLabel,
    defaultName: '角色',
  }).card;
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
    }),
    ...(typeof userAnswers === 'undefined' ? {} : { userAnswers }),
    creationInputs,
    ...(buildState ? { buildState } : {}),
  };
}
