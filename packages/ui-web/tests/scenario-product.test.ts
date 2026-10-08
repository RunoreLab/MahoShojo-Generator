import { describe, expect, it } from 'vitest';
import {
  SCENARIO_OPTIONAL_FIELDS,
  SCENARIO_QUESTIONS,
  createInitialScenarioAnswers,
  hasAnyScenarioAnswer,
} from '../src/scenario';

describe('SCENARIO_QUESTIONS（五问引导，label 即 prompt【】键名）', () => {
  it('五问 id/label/placeholder 逐字钉住——answers 键与 prompt 契约同源', () => {
    expect(SCENARIO_QUESTIONS).toEqual([
      { id: 'scene', label: '故事发生的场景是怎样的？', placeholder: '例如：黄昏时分的废弃钟楼顶端，晚风吹拂，可以俯瞰整座城市...' },
      { id: 'roles', label: '场景中有需要出现的角色（NPC）吗？', placeholder: '【强烈建议】此项填写“未指定”，让AI不生成此项内容。如果需要添加场景固定角色，则在此处填写。' },
      { id: 'events', label: '角色们在这里需要做什么核心事件？', placeholder: '例如：进行一场一对一的决斗；合作解开一个古老的谜题；接受一次特别的采访...' },
      { id: 'atmosphere', label: '希望故事的整体氛围是怎样的？', placeholder: '例如：轻松愉快、紧张悬疑、悲伤感人、热血沸腾...' },
      { id: 'development', label: '故事可能会有哪些有趣的发展方向？', placeholder: '例如：决斗中途有第三方介入；谜题的答案指向一个惊人的秘密；采访者突然问了一个尖锐的问题...' },
    ]);
  });
});

describe('SCENARIO_OPTIONAL_FIELDS（强制留空字段）', () => {
  it('value 精确对应 SCENARIO_GENERATION_SCHEMA 路径', () => {
    expect(SCENARIO_OPTIONAL_FIELDS).toEqual([
      { label: '场景时间', value: 'elements.scene.time' },
      { label: '场景地点', value: 'elements.scene.place' },
      { label: '场景特征', value: 'elements.scene.features' },
      { label: '预设NPC', value: 'elements.roles' },
      { label: '故事氛围', value: 'elements.atmosphere' },
      { label: '发展方向', value: 'elements.development' },
    ]);
  });
});

describe('createInitialScenarioAnswers / hasAnyScenarioAnswer', () => {
  it('初始回答以 label 为键、全部为空串', () => {
    const answers = createInitialScenarioAnswers();
    expect(Object.keys(answers)).toEqual(SCENARIO_QUESTIONS.map((question) => question.label));
    expect(Object.values(answers).every((value) => value === '')).toBe(true);
    expect(hasAnyScenarioAnswer(answers)).toBe(false);
  });

  it('任一回答非空即视为有内容', () => {
    const answers = createInitialScenarioAnswers();
    answers[SCENARIO_QUESTIONS[0]!.label] = '  钟楼  ';
    expect(hasAnyScenarioAnswer(answers)).toBe(true);
    answers[SCENARIO_QUESTIONS[0]!.label] = '   ';
    expect(hasAnyScenarioAnswer(answers)).toBe(false);
  });
});
