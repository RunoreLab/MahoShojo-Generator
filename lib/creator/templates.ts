export const CREATOR_TEMPLATE_IDS = [
  'magical-girl',
  'canshou',
  'general',
  'scenario',
  'general-scenario',
] as const;

export type CreatorTemplateId = (typeof CREATOR_TEMPLATE_IDS)[number];

export const CREATOR_STREAM_TEMPLATE_IDS = ['general', 'general-scenario'] as const;
export type CreatorStreamTemplateId = (typeof CREATOR_STREAM_TEMPLATE_IDS)[number];

export const isCreatorStreamTemplate = (
  templateId: CreatorTemplateId | string
): templateId is CreatorStreamTemplateId =>
  CREATOR_STREAM_TEMPLATE_IDS.includes(templateId as CreatorStreamTemplateId);
