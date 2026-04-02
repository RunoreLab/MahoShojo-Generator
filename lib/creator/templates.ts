export const CREATOR_TEMPLATE_IDS = [
  'magical-girl',
  'canshou',
  'general',
  'scenario',
  'general-scenario',
] as const;

export type CreatorTemplateId = (typeof CREATOR_TEMPLATE_IDS)[number];

export type CreatorTemplateOption = {
  id: CreatorTemplateId;
  label: string;
  description: string;
  kind: 'character' | 'scenario';
};

export const CREATOR_TEMPLATE_OPTIONS: readonly CreatorTemplateOption[] = [
  {
    id: 'magical-girl',
    label: '魔法少女（结构化）',
    description: '完整字段结构，适合后续升华/竞技场联动。',
    kind: 'character',
  },
  {
    id: 'canshou',
    label: '残兽（结构化）',
    description: '完整字段结构，适合保留结构化能力与对抗设定。',
    kind: 'character',
  },
  {
    id: 'general',
    label: '通用角色卡（Markdown）',
    description: '更自由的角色描述正文，适合创作型输出。',
    kind: 'character',
  },
  {
    id: 'scenario',
    label: '情景（结构化）',
    description: '适合后续规则化消费的结构化情景卡。',
    kind: 'scenario',
  },
  {
    id: 'general-scenario',
    label: '通用情景卡（Markdown）',
    description: '适合自由发挥与长文本场景设定。',
    kind: 'scenario',
  },
] as const;

export const CREATOR_STREAM_TEMPLATE_IDS = ['general', 'general-scenario'] as const;
export type CreatorStreamTemplateId = (typeof CREATOR_STREAM_TEMPLATE_IDS)[number];

export const isCreatorStreamTemplate = (
  templateId: CreatorTemplateId | string
): templateId is CreatorStreamTemplateId =>
  CREATOR_STREAM_TEMPLATE_IDS.includes(templateId as CreatorStreamTemplateId);

export const getCreatorTemplateOptionById = (
  templateId: CreatorTemplateId | string
): CreatorTemplateOption | null =>
  CREATOR_TEMPLATE_OPTIONS.find((option) => option.id === templateId) ?? null;
