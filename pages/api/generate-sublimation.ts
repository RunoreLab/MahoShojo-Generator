// pages/api/generate-sublimation.ts

import { z } from 'zod';
import { generateWithAI, GenerationConfig } from '../../lib/ai';
import { getLogger } from '../../lib/logger';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { NextRequest } from 'next/server';
import { generateSignature, verifySignature } from '@/lib/signature';
import magicalGirlQuestionnaire from '../../public/questionnaire.json';
import { config as appConfig } from '../../lib/config';

const log = getLogger('api-gen-sublimation');

export const config = {
  runtime: 'edge',
};

// =================================================================
// 1. Zod Schema 定义
// =================================================================

/**
 * @description 这是一个“完全体”的魔法少女Schema，包含了所有可能被用户选择进行升华的字段。
 * 我们将基于这个Schema，根据用户的选择动态地移除那些需要“保留”的字段。
 */
const FullMagicalGirlSublimationPayloadSchema = z.object({
  codename: z.string().describe("角色的新代号，必须包含原始代号并在后面加上一个「称号」。例如，如果原始代号是'代号'，新代号可以是'代号「称号」'。"),
  appearance: z.object({
    outfit: z.string(),
    accessories: z.string(),
    colorScheme: z.string(),
    overallLook: z.string(),
  }).describe("根据角色经历更新后的外观描述。"),
  magicConstruct: z.object({
    name: z.string().describe("魔装的名字(此字段为固定值，不应修改)。"), // 尽管是不可变的，但在完整结构中包含它
    form: z.string().describe("魔装形态的演变。"),
    basicAbilities: z.array(z.string()).describe("基础能力的进化或新增，不得重复。"),
    description: z.string().describe("对魔装当前状态的全新描述。"),
  }),
  wonderlandRule: z.object({
    name: z.string().describe("奇境的名字(此字段为固定值，不应修改)。"),
    description: z.string(),
    tendency: z.string(),
    activation: z.string(),
  }).describe("奇境规则的改变。"),
  blooming: z.object({
    name: z.string().describe("繁开的名字(此字段为固定值，不应修改)。"),
    evolvedAbilities: z.array(z.string()),
    evolvedForm: z.string(),
    evolvedOutfit: z.string(),
    powerLevel: z.string(),
  }).describe("繁开状态的改变。"),
  analysis: z.object({
    personalityAnalysis: z.string().describe("角色经历一系列事件后的性格分析。"),
    abilityReasoning: z.string().describe("能力进化的内在逻辑和原因。"),
    coreTraits: z.array(z.string()).describe("更新后的核心性格关键词。"),
    predictionBasis: z.string().describe("对角色成长发展的分析依据。"),
    background: z.object({
      belief: z.string().describe("角色信念的演变或深化。"),
      bonds: z.string().describe("角色情感羁绊的变化。"),
    }).describe("角色背景故事的演进。")
  }).describe("对角色分析的全面更新。"),
  userAnswers: z.array(z.string()).optional().describe("根据角色的成长，对问卷问题的全新回答。"),
});

/**
 * @description “完全体”的残兽Schema。
 */
const FullCanshouSublimationPayloadSchema = z.object({
  name: z.string().describe("残兽的新名称，必须包含原始名称并在后面加上一个「称号」。例如，如果原始名称是'名称'，新名称可以是'名称「称号」'。"),
  coreConcept: z.string(),
  coreEmotion: z.string(),
  evolutionStage: z.string(),
  appearance: z.string(),
  materialAndSkin: z.string(),
  featuresAndAppendages: z.string(),
  attackMethod: z.string(),
  specialAbility: z.string(),
  origin: z.string(),
  birthEnvironment: z.string(),
  researcherNotes: z.string().describe("研究员对这次升华的补充笔记。"),
  userAnswers: z.array(z.string()).optional().describe("根据残兽的成长，对问卷问题的全新回答。"),
});


// 升华事件的通用Schema
const SublimationEventSchema = z.object({
    title: z.string().describe("描述本次升华事件的标题。"),
    impact: z.string().describe("对本次升华事件的描述，解释角色是如何被过往经历影响，最终蜕变到新状态的。")
}).describe("描述角色如何升华的事件。");

/**
 * 核心函数：根据用户选择，动态构建AI所需的Zod Schema。
 * @param baseSchema - “完全体”的基础Schema。
 * @param fieldsToPreserve - 用户选择要保持不变的字段键名数组。
 * @returns 一个新的Zod Schema，仅包含AI需要生成的部分。
 */
const createDynamicSchema = (baseSchema: z.ZodObject<any>, fieldsToPreserve: string[]) => {
    let dynamicSchema = baseSchema;
    // 遍历用户要求保留的字段
    for (const field of fieldsToPreserve) {
        // 检查该字段是否存在于基础Schema中
        if (field in baseSchema.shape) {
            // 如果存在，就从Schema中“omit”（省略）掉这个字段
            dynamicSchema = dynamicSchema.omit({ [field]: true });
        }
    }
    // 最终返回一个包含动态生成部分和固定“升华事件”部分的Schema
    return z.object({
        updatedCharacterData: dynamicSchema.describe("一个JSON对象，仅包含所有被AI更新后的字段。"),
        sublimationEvent: SublimationEventSchema
    });
};

// =================================================================
// 2. AI Prompt 配置
// =================================================================

const createGenerationConfig = (characterData: any, language: string, userGuidance: string | null, fieldsToPreserve: string[], isDowngrade: boolean = false): GenerationConfig<any, any> => {
  const isMagicalGirl = !!characterData.codename;
  const characterType = isMagicalGirl ? '魔法少女' : '残兽';
  const nameField = isMagicalGirl ? 'codename' : 'name';
  const baseSchema = isMagicalGirl ? FullMagicalGirlSublimationPayloadSchema : FullCanshouSublimationPayloadSchema;
  
  // 找出需要AI重新生成的字段
  const fieldsToGenerate = Object.keys(baseSchema.shape).filter(key => !fieldsToPreserve.includes(key));

  const promptBuilder = () => {
    const dataForPrompt = { ...characterData };
    delete dataForPrompt.signature;

    const historyText = (dataForPrompt.arena_history?.entries || [])
      .map((entry: any) => `- 事件“${entry.title}”：胜利者是${entry.winner}，对我的影响是“${entry.impact}”`)
      .join('\n') || "无";
    
    let userAnswersReviewSection = "";
    if (isMagicalGirl && dataForPrompt.userAnswers) {
        const questions = magicalGirlQuestionnaire.questions;
        const userAnswersText = dataForPrompt.userAnswers.map((answer: string, i: number) => `Q: ${questions[i] || `问题 ${i+1}`}\nA: ${answer}`).join('\n');
        userAnswersReviewSection = `## 问卷回答回顾 (用于理解角色深层性格)\n${userAnswersText}`;
    }

    let guidanceInstruction = '';
    if (userGuidance) {
      guidanceInstruction = `\n## 成长方向引导\n角色可以朝这个方向成长升华：“${userGuidance}”。请在重塑角色时将此作为最重要的参考。`;
    }

    return `
# 角色成长升华任务
你是一位资深的角色设定师。你的任务是为一个${characterType}角色进行“成长升华”。
该角色经历了诸多事件，现在需要你基于其完整的设定和所有“历战记录”，对其进行一次全面的重塑和升级，以体现其成长与蜕变。

${guidanceInstruction}

## 原始角色设定
\`\`\`json
${JSON.stringify(dataForPrompt, null, 2)}
\`\`\`

## 历战记录回顾
${historyText}

${userAnswersReviewSection}

## 升华规则 (必须严格遵守)
你必须严格遵守以下规则来更新角色设定：
1.  **任务范围**: 你的任务是 **只生成** 以下字段的全新内容：\`${fieldsToGenerate.join('`, `')}\`。
2.  **绝对禁止**: 你 **绝对不能** 在你的JSON输出中包含以下字段：\`${fieldsToPreserve.join('`, `')}\`。这些字段由用户选择保留，你无需关心。
3.  **称号规则**: 角色名称字段(\`${nameField}\`)必须更新。该字段的结构为 \`{代号/名称}\` 或 \`{代号/名称}「{称号}」\`。你 **不可** 修改 \`{代号/名称}\` 部分，但 **必须** 为其生成或更新一个4个字左右（1~8个字）的 \`{称号}\`，并以「」包裹，以体现其新状态。
4.  **生成升华事件**: 你还需要创作一个“升华事件”，简要描述角色是如何从这些经历中收获成长，升华到新状态的。

请严格按照提供的JSON Schema格式返回结果，使用【${language}】进行内容创作。`;
  };

  const finalSchema = createDynamicSchema(baseSchema, fieldsToPreserve);

  return {
    systemPrompt: "你是一位资深的角色设定师，擅长根据角色的经历描绘其成长与蜕变。",
    temperature: 0.7,
    promptBuilder,
    schema: finalSchema,
    taskName: "角色成长升华",
    maxTokens: 8192,
    modelOverride: isDowngrade ? "gemini-2.5-flash-lite" : undefined, // 使用降级模型
  };
};


// =================================================================
// 3. 辅助函数
// =================================================================

function isObject(item: any): boolean {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * 安全地深度合并两个对象。源对象的属性会覆盖目标对象的属性。
 * @param target - 目标对象，将被覆盖。
 * @param source - 源对象，提供更新数据。
 * @returns {any} 返回一个合并后的新对象。
 */
function safeDeepMerge(target: any, source: any): any {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key]) && key in target && isObject(target[key])) {
                output[key] = safeDeepMerge(target[key], source[key]);
            } else {
                output[key] = source[key];
            }
        });
    }
    return output;
}

// =================================================================
// 4. API Handler
// =================================================================

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const { language = 'zh-CN', userGuidance = '', fieldsToPreserve = [], isDowngrade = false, ...originalCharacterData } = body; 
    const finalUserGuidance = userGuidance.trim() || null;

    // 安全检查
    const textToCheck = extractTextForCheck(originalCharacterData) + " " + (finalUserGuidance || '');
    if ((await quickCheck(textToCheck)).hasSensitiveWords) {
        return new Response(JSON.stringify({ error: '输入内容不合规', shouldRedirect: true, reason: '上传的角色档案或引导内容包含危险符文' }), { status: 400 });
    }

    if (!originalCharacterData.arena_history) {
      return new Response(JSON.stringify({ error: '角色数据缺少历战记录 (arena_history)，无法进行升华' }), { status: 400 });
    }

    const isNative = await verifySignature(originalCharacterData);
    const generationConfig = createGenerationConfig(originalCharacterData, language, finalUserGuidance, fieldsToPreserve, isDowngrade);
    
    const aiResult = await generateWithAI(null, generationConfig);
    const updatedDataFromAI = aiResult.updatedCharacterData;

    // --- 数据整合与签名 ---
    // 1. 创建原始数据的深拷贝作为基础
    const sublimatedData: any = JSON.parse(JSON.stringify(originalCharacterData));

    // 1.1 确保 templateId 存在
    if (!sublimatedData.templateId) {
        sublimatedData.templateId = sublimatedData.codename 
            ? "魔法少女/心之花/魔法少女（问卷生成）" 
            : "魔法少女/心之花/残兽（问卷生成）";
        log.info('为旧版角色数据补充了 templateId');
    }

    // 2. 将AI生成的新数据安全地合并到这个副本上
    // safeDeepMerge会递归地合并对象，确保不会丢失嵌套结构
    Object.assign(sublimatedData, safeDeepMerge(sublimatedData, updatedDataFromAI));

    // 3. 重新应用不可变字段，确保它们绝对不会被AI意外修改
    const isMagicalGirl = 'codename' in originalCharacterData;
    if (isMagicalGirl) {
      sublimatedData.magicConstruct.name = originalCharacterData.magicConstruct.name;
      sublimatedData.blooming.name = originalCharacterData.blooming.name;
    }

    // 4. 更新历战记录
    const oldEntries = originalCharacterData.arena_history.entries || [];
    const sublimationEntries = oldEntries.filter((entry: any) => entry.type === 'sublimation');
    const lastEntryId = oldEntries.length > 0 ? Math.max(...oldEntries.map((e: any) => e.id)) : 0;
    
    sublimationEntries.push({
      id: lastEntryId + 1,
      type: 'sublimation',
      title: aiResult.sublimationEvent.title,
      participants: [isMagicalGirl ? sublimatedData.codename : sublimatedData.name],
      winner: isMagicalGirl ? sublimatedData.codename : sublimatedData.name,
      impact: aiResult.sublimationEvent.impact,
      metadata: { user_guidance: finalUserGuidance, scenario_title: null, non_native_data_involved: !isNative || !!finalUserGuidance }
    });
    sublimatedData.arena_history.entries = sublimationEntries;

    // 5. 更新历战记录属性
    const nowISO = new Date().toISOString();
    sublimatedData.arena_history.attributes.sublimation_count = (originalCharacterData.arena_history.attributes.sublimation_count || 0) + 1;
    sublimatedData.arena_history.attributes.updated_at = nowISO;
    sublimatedData.arena_history.attributes.last_sublimation_at = nowISO;

    // 6. 签名逻辑
    // 默认情况下，有引导的升华会失去原生性
    let shouldSign = isNative && !finalUserGuidance;
    // 但是，如果管理员在配置中开启了特例，则即使有引导也进行签名
    if (isNative && finalUserGuidance && appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING) {
      shouldSign = true;
    }

    if (shouldSign) {
        sublimatedData.signature = await generateSignature(sublimatedData);
    } else {
        delete sublimatedData.signature;
    }

    const finalResponse = {
        sublimatedData,
        unchangedFields: fieldsToPreserve
    };

    return new Response(JSON.stringify(finalResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    log.error('成长升华失败', { error });
    const errorMessage = error instanceof Error ? `角色成长升华失败: ${error.message}` : '角色成长升华失败: 发生未知错误';
    return new Response(JSON.stringify({ error: errorMessage, message: errorMessage }), { status: 500 });
  }
}

/**
 * 递归提取对象中所有字符串值的函数，用于敏感词检查。
 * @param data 要提取文本的对象。
 * @returns 连接所有字符串值的单个字符串。
 */
const extractTextForCheck = (data: any): string => {
    let textContent = '';
    if (typeof data === 'string') {
        textContent += data + ' ';
    } else if (Array.isArray(data)) {
        data.forEach(item => { textContent += extractTextForCheck(item); });
    } else if (typeof data === 'object' && data !== null) {
        for (const key in data) {
            if (key !== 'signature' && key !== 'userAnswers') {
                textContent += extractTextForCheck(data[key]);
            }
        }
    }
    return textContent;
};

export default handler;