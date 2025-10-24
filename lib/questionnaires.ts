export interface MagicalQuestionMeta {
  id: string;
  placeholder?: string;
  suggestions?: string[];
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  allowCustom?: boolean;
  helperText?: string;
  maxLength?: number;
}

// 预设选项与提示，参考残兽问卷的交互体验
const MAGICAL_META_CATALOG: MagicalQuestionMeta[] = [
  {
    id: 'MG-1',
    placeholder: '请填写角色的名字',
    suggestions: ['白思与', '二阶堂祥子', '雪莉', '咕咕嘎嘎！', '真名只不过是表面之物罢了，不足挂齿'],
    maxLength: 100
  },
  {
    id: 'MG-2',
    suggestions: ['违背嘱托冲上去救她', '呼叫支援掩护撤退', '想办法调虎离山', '冲过去救她，命令可以事后解释', '用尽一切手段去救她，即使因此受罚', '我会尊重她的意志，直到最后一刻'],
    helperText: '描述你在危急时刻的本能反应',
    maxLength: 140
  },
  {
    id: 'MG-3',
    suggestions: ['握住她的手告诉她已经足够好了', '主动请缨承担失误的后果', '提议暂停任务总结经验', '告诉她这是团队的战斗，错误由我们一起承担', '先治愈她，再约定下一次一起赢回来', '比起沉湎于复杂的懊悔，用简单的行动来弥补，才是正道'],
    helperText: '聚焦你与搭档的关系',
    maxLength: 140
  },
  {
    id: 'MG-4',
    options: [
      { value: '毫不犹豫地答应', label: '毫不犹豫地答应' },
      { value: '会慎重衡量', label: '会慎重衡量风险与代价' },
      { value: '坚持寻找替代方案', label: '坚持寻找替代方案' },
      { value: '先护住她们撤离', label: '先护住她们撤离，再想办法逆转局势' }
    ],
    allowCustom: true,
    helperText: '你愿意牺牲到什么程度？'
  },
  {
    id: 'MG-5',
    options: [
      { value: '守护重要之人', label: '守护重要之人' },
      { value: '修复破碎的城市', label: '修复破碎的城市' },
      { value: '治愈自己或他人的伤痛', label: '治愈自己或他人的伤痛' },
      { value: '带回失落的光芒', label: '把光带回被黑暗笼罩的城市' }
    ],
    allowCustom: true,
    placeholder: '第一次想完成的事情…'
  },
  {
    id: 'MG-6',
    options: [
      { value: '防御与支援型魔法', label: '防御与支援型魔法' },
      { value: '瞬间爆发的攻击魔法', label: '瞬间爆发的攻击魔法' },
      { value: '改变局势的策略魔法', label: '改变局势的策略魔法' }
    ],
    allowCustom: true,
    placeholder: '描述你期望的能力',
    suggestions: ['治愈一切伤痕的力量', '让时间倒流，挽回失去的人']
  },
  {
    id: 'MG-7',
    suggestions: ['灯火', '羽翼', '晨星', '流星', '余烬', '潮汐']
  },
  {
    id: 'MG-8',
    options: [
      { value: '挫败敌人', label: '挫败敌人' },
      { value: '保护队友', label: '保护队友' },
      { value: '依据情况权衡', label: '依据情况权衡' },
      { value: '先护队友再反击', label: '先保护队友，再寻找反击机会' }
    ],
    allowCustom: true
  },
  {
    id: 'MG-9',
    options: [
      { value: '命运可以被改变', label: '命运可以被改变' },
      { value: '命运注定但可迂回', label: '命运注定但可迂回' },
      { value: '顺应命运寻求意义', label: '顺应命运寻求意义' },
      { value: '命运注定但意义可改写', label: '命运或许注定，但结果的意义由自己决定' }
    ],
    allowCustom: true
  },
  {
    id: 'MG-10',
    options: [
      { value: '选择拯救多数人', label: '选择拯救多数人' },
      { value: '绝不牺牲无辜', label: '绝不牺牲无辜' },
      { value: '尝试寻找第三条路', label: '尝试寻找第三条路' },
      { value: '成为那个“少数”', label: '如果必须牺牲，就由我成为那个“少数”' }
    ],
    allowCustom: true
  },
  {
    id: 'MG-11',
    options: [
      { value: '必要之恶可以被接受', label: '必要之恶可以被接受' },
      { value: '必要之恶会腐蚀初心', label: '必要之恶会腐蚀初心' },
      { value: '只有在明确边界时才允许', label: '只有在明确边界时才允许' }
    ],
    allowCustom: true,
    helperText: '谈谈你对“代价”与“底线”的理解'
  },
  {
    id: 'MG-12',
    options: [
      { value: '直接指出并提出改进', label: '直接指出并提出改进' },
      { value: '先搜集证据再报告', label: '先搜集证据再报告' },
      { value: '尊重但寻求其他队友协助', label: '尊重但寻求其他队友协助' },
      { value: '独自承担风险', label: '选择独自承担，避免牵连他人' }
    ],
    allowCustom: true
  },
  {
    id: 'MG-13',
    options: [
      { value: '更喜欢独自行动', label: '更喜欢独自行动' },
      { value: '依赖团队合作', label: '依赖团队合作' },
      { value: '根据任务灵活切换', label: '根据任务灵活切换' },
      { value: '取决于队友是谁', label: '取决于队友是谁' }
    ],
    allowCustom: true
  },
  {
    id: 'MG-14',
    options: [
      { value: '计划为先', label: '计划为先' },
      { value: '凭直觉行动', label: '凭直觉行动' },
      { value: '先计划再顺势调整', label: '先计划再顺势调整' },
      { value: '计划与直觉并重', label: '先制定蓝图，再视战况灵活调整' }
    ],
    allowCustom: true
  },
  {
    id: 'MG-15',
    suggestions: ['夏夜烟花下的约定', '第一次见到魔法少女的瞬间', '与家人重逢的拥抱', '在湿地下被前辈救起的瞬间', '雨中的葬礼与粉色樱花的凋零', '我……没有经历过……', '咕咕嘎嘎！'],
    maxLength: 160
  },
  {
    id: 'MG-16',
    suggestions: ['曾经撤退导致同伴受伤', '因为犹豫而错失机会', '没有勇敢说出的告白', '没能阻止亲人遭遇不幸', '如果当时我更强就好了', '我曾经因为顾虑一份复杂的人情，而没有及时出手，导致同伴受到了本可以避免的伤害。现在我不会再犹豫。', '咕咕嘎嘎！'],
    helperText: '描述你想弥补的遗憾',
    maxLength: 160
  }
];

export const buildMagicalQuestionMeta = (length: number): MagicalQuestionMeta[] => {
  if (length <= 0) return [];
  return Array.from({ length }).map((_, index) => {
    const catalogMeta = MAGICAL_META_CATALOG[index];
    return {
      id: catalogMeta?.id ?? `MG-${index + 1}`,
      placeholder: catalogMeta?.placeholder,
      suggestions: catalogMeta?.suggestions ?? [],
      options: catalogMeta?.options,
      allowCustom: catalogMeta?.allowCustom !== undefined ? catalogMeta.allowCustom : true,
      helperText: catalogMeta?.helperText,
      maxLength: catalogMeta?.maxLength ?? 120
    };
  });
};
