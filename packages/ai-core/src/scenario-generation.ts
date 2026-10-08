import { z } from 'zod/v3';

export const SCENARIO_GENERATION_SCHEMA = z.object({
  title: z.string().describe('情景的标题【必需】。根据用户回答，为这个情景取一个简洁而富有吸引力的标题。'),
  scenario_type: z.string().describe('情景类型【必需】。根据情景的核心内容，为其分类（例如：日常、互动、考试、竞技比赛、调查、采访等）。'),
  description: z.string().describe('情景的简短描述。'),
  elements: z.object({
    scene: z.object({
      time: z.string().optional().describe('故事发生的时间。'),
      place: z.string().optional().describe('故事发生的地点。'),
      features: z.string().optional().describe('环境特征和陈设等。'),
    }).describe('场景描述。如果用户未提供，可留空或注明“未指定”。'),
    roles: z.array(z.object({
      name: z.string().describe('角色名称或身份。'),
      description: z.string().describe('该角色的设定、目标或行为准则。'),
    })).optional().describe('预设的NPC角色信息，可留空。'),
    events: z.string().describe('核心事件描述 (角色需要做什么？会怎么互动？有什么冲突？)。'),
    atmosphere: z.string().describe('故事的情感基调和氛围。'),
    development: z.array(z.string()).describe('故事可能的多个发展方向。'),
  }),
}).describe('一个结构化的情景设定，用于后续故事。');

export type ScenarioGeneratedData = z.infer<typeof SCENARIO_GENERATION_SCHEMA>;

export type NativeScenarioData = ScenarioGeneratedData & {
  metadata: {
    created_at: string;
    signature?: string;
  };
};

export type ScenarioGenerationInput = {
  answers: Record<string, string>;
  language: string;
  fieldsToKeepEmpty: string[];
};

export type ScenarioStreamPromptInput = {
  answers: Record<string, unknown>;
  language: string;
  fieldsToKeepEmpty: unknown;
  titleHint?: unknown;
};

export const SCENARIO_GENERATION_SYSTEM_PROMPT = '你是一位富有想象力的世界观构架师和剧本作家，擅长将零散的想法整合成结构化的故事场景。';
export const SCENARIO_GENERATION_TEMPERATURE = 0.7;
export const SCENARIO_STREAM_TEMPERATURE = 0.75;
export const SCENARIO_GENERATION_TASK_NAME = '生成情景';

export const buildScenarioCorePrinciples = (language: string): string => `
## 核心创作原则

1.  **情景元素**：你创作的情景可以多样，但不能出现与魔法少女主题严重冲突的元素，并且应当符合公序良俗。
2.  **创意与整合**：你的核心工作是将原始情景设定富有创意地整合成一个逻辑自洽、充满想象力的完整情景。你需要发掘设定背后隐藏的信息与深层含义，并将其反映在情景的各个要素中。
3.  **结构化输出**：你必须严格按照我提供的模板格式返回结果，不得有任何遗漏或格式错误。
4.  **处理留白**：原始情景设定可能不会包含所有要素，或者信息很模糊。在这种情况下，你拥有一定的创作自由度。对于留空的核心要素（如“角色”），请直接将其设定为空值或空数组，并在描述中注明“未指定”或“待定”，以便用户后续添加。
5.  **语言使用**：请你必须使用【${language}】进行内容创作。
`.trim();

export const buildScenarioMarkdownRequirements = (language: string): string => `
【重要】输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出“我将要/我不能”之类的解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写情景标题，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 标题：...
5) 正文建议包含：场景概览、时间、地点、环境特征、预设NPC（可选）、核心事件、整体氛围、发展方向（多条）。
`.trim();

export const buildScenarioStructuredPrompt = (input: ScenarioGenerationInput): string => {
  const answers = input.answers as Record<string, string>;
  const fieldsToKeepEmpty = input.fieldsToKeepEmpty as string[];
  const answerText = Object.entries(answers)
    .filter(([, value]) => value.trim() !== '')
    .map(([key, value]) => `【${key}】\n${value}\n`)
    .join('\n');
  const emptyFieldsInstruction = fieldsToKeepEmpty && fieldsToKeepEmpty.length > 0
    ? `
## 强制留空指令 (CRITICAL INSTRUCTION)
用户已指定以下字段必须留空。在你的JSON输出中：
- 对于类型为 "string" 的字段，你必须返回一个空字符串 ""。
- 对于类型为 "array" 的字段，你必须返回一个空数组 []。
绝对不要为这些字段生成任何内容。
需要留空的字段列表:
${fieldsToKeepEmpty.map((field) => `- ${field}`).join('\n')}
`
    : '';

  return `
你是一个富有想象力的故事场景设计师。你的任务是根据用户提供的几个核心要素，构思并生成一个结构化的、可供后续故事使用的自定义情景（Scenario）文件。

${buildScenarioCorePrinciples(input.language)}

${emptyFieldsInstruction}

## 用户的回答
${answerText}

现在，请开始你的创作。
`;
};

export const createScenarioGenerationConfig = (_input: ScenarioGenerationInput) => ({
  systemPrompt: SCENARIO_GENERATION_SYSTEM_PROMPT,
  temperature: SCENARIO_GENERATION_TEMPERATURE,
  promptBuilder: (): string => buildScenarioStructuredPrompt(_input),
  schema: SCENARIO_GENERATION_SCHEMA,
  taskName: SCENARIO_GENERATION_TASK_NAME,
});

export const buildScenarioStreamPrompt = (input: ScenarioStreamPromptInput): string => {
  const normalizedEmptyFields = Array.isArray(input.fieldsToKeepEmpty)
    ? input.fieldsToKeepEmpty
      .filter((item: unknown): item is string => typeof item === 'string' && Boolean(item.trim()))
      .slice(0, 32)
    : [];
  const answerText = Object.entries(input.answers)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `【${key}】\n${String(value).trim()}\n`)
    .join('\n');
  const emptyFieldsInstruction = normalizedEmptyFields.length > 0
    ? `
【强制留空指令】
用户已指定以下内容必须排除：请勿输出对应内容，不要擅自补全。
需要排除的内容列表：
${normalizedEmptyFields.map((field) => `- ${field}`).join('\n')}
`.trim()
    : '';
  const titleHintText = typeof input.titleHint === 'string' && input.titleHint.trim()
    ? `\n【用户期望的情景标题（可参考）】\n${input.titleHint.trim().slice(0, 60)}\n`
    : '';
  return `
你是一个富有想象力的故事场景设计师。你的任务是根据用户提供的要素，生成一份【情景】设定文本，用于后续故事。

${buildScenarioMarkdownRequirements(input.language)}

${emptyFieldsInstruction}
${titleHintText}

【用户的回答】
${answerText}
`.trim();
};
