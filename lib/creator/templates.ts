export const CREATOR_TEMPLATE_IDS = [
  'magical-girl',
  'canshou',
  'general',
  'scenario',
  'general-scenario',
] as const;

export type CreatorTemplateId = (typeof CREATOR_TEMPLATE_IDS)[number];

export const CREATOR_STREAM_TEMPLATE_IDS: readonly CreatorTemplateId[] = [
  'general',
  'general-scenario',
];

export const isCreatorStreamTemplate = (
  templateId: CreatorTemplateId | string
): templateId is CreatorTemplateId =>
  CREATOR_STREAM_TEMPLATE_IDS.includes(templateId as CreatorTemplateId);
