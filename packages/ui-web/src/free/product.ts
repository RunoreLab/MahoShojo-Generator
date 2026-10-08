import {
  FREE_STREAM_SCHEMA_IDS,
  type FreeSchemaId,
} from '@mahoshojo/ai-core/free-generation';

/**
 * /free 页面产品定义（D5.1-G2-r1 收口后上移）：Schema 目录、字段速览与
 * 提示词占位文案原属 Web/Desktop 各自页面内的重复常量，逐字一致才符合
 * 「同一产品」口径。文案以 Web 现网实现为 canonical 来源。
 */

export interface FreeSchemaOption {
  id: FreeSchemaId;
  label: string;
  description: string;
  kind: 'character' | 'scenario';
}

export const FREE_SCHEMA_OPTIONS: readonly FreeSchemaOption[] = [
  { id: 'magical-girl', label: '魔法少女（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
  { id: 'canshou', label: '残兽（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
  { id: 'general', label: '通用角色卡（Markdown）', description: '只有 name/content，适合自由发挥与长线维护。', kind: 'character' },
  { id: 'scenario', label: '情景（结构化）', description: 'elements 结构化字段，适合与竞技场/进阶玩法联动。', kind: 'scenario' },
  { id: 'general-scenario', label: '通用情景卡（Markdown）', description: '只有 title/content，适合自由发挥与长线维护。', kind: 'scenario' },
];

/** 流式模式只产 Markdown 通用卡：可选 Schema 收敛为 ai-core 的流式白名单。 */
export const freeSchemaOptionsForMode = (
  mode: 'stream' | 'non-stream',
): readonly FreeSchemaOption[] =>
  mode === 'stream'
    ? FREE_SCHEMA_OPTIONS.filter((option) =>
      (FREE_STREAM_SCHEMA_IDS as readonly string[]).includes(option.id))
    : FREE_SCHEMA_OPTIONS;

export const FREE_PROMPT_PLACEHOLDER =
  '在这里写你的完整提示词：你想要的风格、设定、限制、字段填充偏好等都由你决定。';

/** UI 用字段速览（系统提示词说明文本），两端逐字同文案。 */
export const buildFreeFieldGuide = (schemaId: FreeSchemaId): string => {
  switch (schemaId) {
    case 'magical-girl':
      return [
        '魔法少女（结构化）字段速览：',
        '- codename：代号（建议花名/称号）',
        '- appearance：外观（outfit/accessories/colorScheme/overallLook，可选）',
        '- magicConstruct：魔装（name/form/basicAbilities/description，可选）',
        '- wonderlandRule：奇境规则（name/description/tendency/activation，可选）',
        '- blooming：繁开（name/evolvedAbilities/evolvedForm/evolvedOutfit/powerLevel，可选）',
        '- analysis：分析（personalityAnalysis/abilityReasoning/coreTraits/predictionBasis/background，可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'canshou':
      return [
        '残兽（结构化）字段速览：',
        '- name：名称',
        '- appearance/materialAndSkin/featuresAndAppendages/coreConcept/coreEmotion/evolutionStage/attackMethod/specialAbility/origin/birthEnvironment/researcherNotes（均可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'scenario':
      return [
        '情景（结构化）字段速览：',
        '- title：标题（必需）',
        '- scenario_type/description（可选）',
        '- elements：必需',
        '  - scene.time/place/features（可选）',
        '  - roles：可选数组，每项包含 name/description（可选）',
        '  - events/atmosphere/development（可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'general':
      return [
        '通用角色卡字段速览：',
        '- templateId：固定为 通用角色',
        '- name：角色名',
        '- content：正文（建议 Markdown）',
      ].join('\n');
    case 'general-scenario':
      return [
        '通用情景卡字段速览：',
        '- templateId：固定为 通用情景',
        '- title：情景名',
        '- content：正文（建议 Markdown）',
      ].join('\n');
    default:
      return '';
  }
};
