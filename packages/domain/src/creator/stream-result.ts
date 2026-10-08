import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
} from '../markdown-card';

import { buildPersistedCreationInputs } from './card-metadata';
import type { CreatorStreamTemplateId } from './templates';

/**
 * 创作工房流式 Markdown → 通用卡的投影（D5.1-G3 上移共源）。
 * Web/Desktop 两侧从同一 Markdown 产出同一卡面：
 * general → 通用角色卡；general-scenario → 通用情景卡，
 * 均回带 creationInputs/buildState（以及可选 userAnswers）元数据。
 */
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
