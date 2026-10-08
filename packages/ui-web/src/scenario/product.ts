/**
 * /scenario 页面产品定义（D5.1-G2-r1 收口后上移）。
 *
 * 注意：`answers` 以 question.label 为键、直接经 ai-core 拼进 prompt 的
 * `【label】` 块——label 文案就是 prompt 契约的一部分，双端必须逐字一致。
 * `SCENARIO_OPTIONAL_FIELDS` 的 `value` 精确对应
 * `SCENARIO_GENERATION_SCHEMA`（ai-core/scenario-generation）中的路径。
 */

export interface ScenarioQuestion {
  id: string;
  label: string;
  placeholder: string;
}

export const SCENARIO_QUESTIONS: readonly ScenarioQuestion[] = [
  { id: 'scene', label: '故事发生的场景是怎样的？', placeholder: '例如：黄昏时分的废弃钟楼顶端，晚风吹拂，可以俯瞰整座城市...' },
  { id: 'roles', label: '场景中有需要出现的角色（NPC）吗？', placeholder: '【强烈建议】此项填写“未指定”，让AI不生成此项内容。如果需要添加场景固定角色，则在此处填写。' },
  { id: 'events', label: '角色们在这里需要做什么核心事件？', placeholder: '例如：进行一场一对一的决斗；合作解开一个古老的谜题；接受一次特别的采访...' },
  { id: 'atmosphere', label: '希望故事的整体氛围是怎样的？', placeholder: '例如：轻松愉快、紧张悬疑、悲伤感人、热血沸腾...' },
  { id: 'development', label: '故事可能会有哪些有趣的发展方向？', placeholder: '例如：决斗中途有第三方介入；谜题的答案指向一个惊人的秘密；采访者突然问了一个尖锐的问题...' },
];

export interface ScenarioOptionalField {
  label: string;
  value: string;
}

export const SCENARIO_OPTIONAL_FIELDS: readonly ScenarioOptionalField[] = [
  { label: '场景时间', value: 'elements.scene.time' },
  { label: '场景地点', value: 'elements.scene.place' },
  { label: '场景特征', value: 'elements.scene.features' },
  { label: '预设NPC', value: 'elements.roles' },
  { label: '故事氛围', value: 'elements.atmosphere' },
  { label: '发展方向', value: 'elements.development' },
];

/** 初始回答表：以 label 为键（label 即 prompt 键名）。 */
export const createInitialScenarioAnswers = (): Record<string, string> =>
  Object.fromEntries(SCENARIO_QUESTIONS.map((question) => [question.label, '']));

/** 是否存在任一非空回答（客户端生成门禁用）。 */
export const hasAnyScenarioAnswer = (answers: Record<string, string>): boolean =>
  Object.values(answers).some((value) => value.trim() !== '');
