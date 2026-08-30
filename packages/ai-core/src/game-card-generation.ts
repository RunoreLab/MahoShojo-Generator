import { GameCardFaceDataSchema } from '@mahoshojo/contracts/game-card';

export interface GameCardGenerationInput {
  sourceCardJson: string;
  customInstructions?: string;
}

export const GAME_CARD_SYSTEM_PROMPT = `你是一位资深的卡牌游戏设计师，精通各种卡牌游戏（如万智牌、游戏王、炉石传说、影之诗等）的卡面设计原则。

你的任务是根据用户提供的角色卡、情景卡或其他数据卡内容，生成一张卡牌游戏风格的卡面元数据。

设计原则：
1. 稀有度（rarity）应与角色/内容的实力和独特性匹配：普通角色 → common/uncommon，有特色 → rare，强力/独特 → epic，核心/首领级 → legendary，超越常规 → mythic
2. 花费（cost）应与强度成正比，一般在 0-10 之间，极特殊情况可达 12-15
3. 属性（element）应根据角色特征推断：火系→fire，水系→water，土系/防御→earth，风系/敏捷→wind，光明/治愈→light，黑暗/诅咒→dark，虚空/异质→void，无属性→neutral
4. 攻击力/防御力/生命值（attack/defense/hp）仅对战斗类卡牌（character/creature）有意义；法术/场景/装备/辅助卡可为 null
5. 效果（effects）应忠实反映原数据卡中的能力，用卡牌游戏术语重新表述，每个效果需标注类型（如"被动"、"入场"、"触发"、"觉醒"等）
6. 关键词特性（traits）提取自角色能力，使用通用卡牌术语如"飞行"、"先攻"、"嘲讽"、"速攻"、"吸血"、"护盾"等
7. 风味文本（flavorText）应是一句能体现角色个性的引言或格言，不超过 50 字
8. 强度评级（powerLevel）使用 S+/S/A+/A/B+/B/C+/C/D 等级
9. 主题色（themeColor）选择最能代表角色的颜色，hex 格式
10. 卡牌名称（cardName）可以直接使用角色代号/名称，也可稍作修饰使其更有卡牌感

请始终用中文输出所有描述性文本。`;

export const buildGameCardGenerationPrompt = (input: GameCardGenerationInput): string => {
  const parts: string[] = [
    '请根据以下数据卡内容，生成一张卡牌游戏风格的卡面元数据。\n',
    '--- 数据卡内容 ---',
    input.sourceCardJson,
  ];

  if (input.customInstructions && input.customInstructions.trim()) {
    parts.push('\n--- 用户附加要求 ---', input.customInstructions.trim());
  }

  parts.push(
    '\n--- 要求 ---',
    '1. 仔细分析数据卡内容，提取角色的核心特征、能力和定位',
    '2. 将其转化为卡牌游戏术语和数值',
    '3. 确保卡面信息忠实于原始设定，不凭空捏造核心设定',
    '4. themeColor 必须是有效的 hex 颜色值（如 "#ff6b9d"）',
    '5. effects 数组至少包含 1 个效果，通常 2-4 个',
    '6. traits 数组至少包含 1 个关键词，通常 2-5 个',
  );

  return parts.join('\n');
};

export interface GameCardGenerationConfig {
  systemPrompt: string;
  temperature: number;
  promptBuilder: typeof buildGameCardGenerationPrompt;
  schema: typeof GameCardFaceDataSchema;
  taskName: string;
  maxOutputTokens?: number;
}

export const GAME_CARD_GENERATION_CONFIG: Readonly<GameCardGenerationConfig> = Object.freeze({
  systemPrompt: GAME_CARD_SYSTEM_PROMPT,
  temperature: 0.7,
  promptBuilder: buildGameCardGenerationPrompt,
  schema: GameCardFaceDataSchema,
  taskName: 'generate-game-card',
});
