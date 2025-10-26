// pages/api/generate-magical-girl-details.ts
import { generateWithAI, GenerationConfig } from '../../lib/ai';
import { z } from 'zod';
import { getRandomFlowers } from '../../lib/random-choose-hana-name';
// import { saveToD1 } from '../../lib/d1';
import { getLogger } from '../../lib/logger';
import { generateSignature } from '../../lib/signature'; // 导入签名工具
import { buildMagicalQuestionMeta } from '../../lib/questionnaires';

const log = getLogger('api-gen-details');

export const config = {
  runtime: 'edge',
};

// 定义基于问卷的魔法少女详细信息生成 schema
const MagicalGirlDetailsSchema = z.object({
  codename: z.string().describe(`代号：魔法少女对应的一种花的名字，根据性格、理念匹配合适的花语对应的花名。可以从我提供的花名中选取最合适的一个，也可以生成一个其他的更合适的花名。`),
  appearance: z.object({
    outfit: z.string().describe("魔法少女变身后的服装和饰品的详细描述，50字左右"),
    accessories: z.string().describe("变身后的饰品细节描述，50字左右"),
    colorScheme: z.string().describe("参考问卷生成主要色调和配色方案"),
    overallLook: z.string().describe("整体外观风格，包括发色、瞳色、发型、体型、服饰和神态表情，60字左右")
  }),
  magicConstruct: z.object({
    name: z.string().describe("魔装的名字"),
    form: z.string().describe("魔装的具体形态和外观"),
    basicAbilities: z.array(z.string()).describe("魔装的基本能力列表，2-3个核心能力"),
    description: z.string().describe("魔装的详细描述和特色")
  }),
  wonderlandRule: z.object({
    name: z.string().describe("奇境规则的名称"),
    description: z.string().describe("奇境规则的具体内容和效果"),
    tendency: z.string().describe("规则的倾向类型"),
    activation: z.string().describe("规则激活的条件或方式")
  }),
  blooming: z.object({
    name: z.string().describe("繁开状态魔装名"),
    evolvedAbilities: z.array(z.string()).describe("繁开后的进化能力，2-3个强化能力"),
    evolvedForm: z.string().describe("繁开后的魔装形态变化"),
    evolvedOutfit: z.string().describe("繁开后的魔法少女衣装样式"),
    powerLevel: z.string().describe("繁开状态的力量等级描述")
  }),
  analysis: z.object({
    personalityAnalysis: z.string().describe("基于问卷回答的性格分析"),
    abilityReasoning: z.string().describe("能力设定的推理过程和依据"),
    coreTraits: z.array(z.string()).describe("核心性格特征，3-4个关键词"),
    predictionBasis: z.string().describe("预测的主要依据和逻辑"),
    // 角色背景故事
    background: z.object({
        belief: z.string().describe("角色的核心理念、信条或愿望，描述角色为何而战，支撑角色行动的内在动力。"),
        bonds: z.string().describe("角色的情感、羁绊，描述角色与他人（特别是在问卷中出现的人）之间的关系，以及这段关系如何影响了角色，羁绊会如何影响其成长的旅途。")
    }).describe("角色的背景故事，用以丰富角色的立体形象与人物弧光，体现角色的信念与感情。")
  })
})

type MagicalGirlDetails = z.infer<typeof MagicalGirlDetailsSchema>;


// 配置详细信息生成
const magicalGirlDetailsConfig: GenerationConfig<MagicalGirlDetails, { answers: string[], language: string }> = {
  systemPrompt: `现在如果你是魔法国度的妖精，你准备通过问卷调查的形式，事先通过问卷结果分析某人成为魔法少女后的能力等各项素质。魔法少女的性格倾向、经历背景、行事准则等等都会影响到她们在魔法少女道路上的潜力和表现。
以下是一位潜在魔法少女对问卷所给出的回答（对方可以不回答某些问题），请你据此预测她成为魔法少女后的情况。

问卷问题列表：
1.你的真实名字是？
2.假如前辈事先告诉你无论如何都不要插手她的战斗，而她现在在你眼前即将被敌人杀死，你会怎么做？
3.你与搭档一起执行任务时，她的失误导致你身受重伤，而她也为此而自责，你会怎么做？
4.你是否愿意遭受会使你永久失去大部分力量的重大伤势，以拯救临时和你一起行动的不熟悉的同伴？
5.你第一次使用魔法时，最希望完成的事情是？
6.你更希望获得什么样的能力？
7.请写下一个你现在脑中浮现的名词（如灯火、盾牌、星辰等）。
8.对你而言，是“挫败敌人”更重要，还是“保护队友”更重要？
9.你认为命运是注定的，还是一切都能改变？
10.如果必须牺牲无辜的少数才能拯救多数，你会如何选择？
11.你会如何看待“必要之恶”？
12.假如你发现你的前辈或上级做出了错误的决策，并且没有人指出来，你会怎么做？
13.你更喜欢独自行动，还是和伙伴一起？
14.你在执行任务时更倾向计划周密还是依赖直觉？
15.你人生中最难忘的一个瞬间是什么？
16.有没有一个你至今仍然后悔的决定？你现在会怎么做？

你需要严格按照提供的 JSON schema 格式返回你的预测结果和相应的解释内容，结果中的内容解释如下。
1.魔力构装（简称魔装）：魔法少女的本相魔力所孕育的能力具现，是魔法少女能力体系的基础。一般呈现为魔法少女在现实生活中接触过，在冥冥之中与其命运关联或映射的物体，并且与魔法少女特色能力相关。例如，泡泡机形态的魔装可以使魔法少女制造魔法泡泡，而这些泡泡可以拥有产生幻象、缓冲防护、束缚困敌等能力。这部分的内容需包含魔装的名字（通常为2字词），魔装的形态，魔装的基本能力。
2.奇境规则：魔法少女的本相灵魂所孕育的能力，是魔装能力的一体两面。奇境是魔装能力在规则层面上的升华，体现为与魔装相关的规则领域，而规则的倾向则会根据魔法少女的倾向而有不同的发展。例如，泡泡机形态的魔装升华而来的奇境规则可以是倾向于守护的“戳破泡泡的东西将会立即无效化”，也可以是倾向于进攻的“沾到身上的泡泡被戳破会立即遭受伤害”。
3.繁开：是魔法少女魔装能力的二段进化与解放，无论是作为魔法少女的魔力衣装还是魔装的武器外形都会发生改变。需包含繁开状态魔装名（需要包含原魔装名的每个字），繁开后的进化能力，繁开后的魔装形态，繁开后的魔法少女衣装样式（在通常变身外观上的升级与改变）。
4.角色背景：请在 "analysis" -> "background" 字段中，深入挖掘并创作能够体现角色立体形象与人物弧光的背景故事。
- **信念 (belief)**：根据问卷回答，提炼出角色的核心价值观和战斗理由。角色是为何而战？她的行动准则是什么？
- **羁绊 (bonds)**：根据问卷中涉及他人的回答（如前辈、搭档、家人等），描绘出角色的羁绊关系。关系可以是正面的，也可以是负面的，但应是塑造她性格和能力的关键。
`,
  temperature: 0.8,
  promptBuilder: ({ answers, language }) => {
    const questionAnswerPairs = answers.map((answer, index) => `问题${index + 1}的回答: "${answer}"`).join('\n');
    const flowers = getRandomFlowers();
    return `请基于以下问卷回答开始分析和预测：${questionAnswerPairs}，可选的花名和对应的花语：${flowers}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: MagicalGirlDetailsSchema,
  taskName: "生成魔法少女详细信息",
  maxTokens: 8192,
}

// 处理器重构：
// 移除了队列和速率限制系统。该系统基于内存，在Serverless/Edge环境中无法正确共享状态，
// 导致功能失效并错误地拦截了前端的轮询请求。
// 现在，请求将直接、异步地调用AI生成函数。
async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await req.json();
  const rawAnswers = body?.answers;
  const language = body?.language ?? 'zh-CN';

  if (!rawAnswers || !Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    return new Response(JSON.stringify({ error: 'Answers array is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const questionMeta = buildMagicalQuestionMeta(rawAnswers.length);
  const normalizedAnswers: string[] = [];

  // 基于题目元数据验证每个答案的字数上限
  for (const [index, answer] of rawAnswers.entries()) {
    if (typeof answer !== 'string') {
      return new Response(JSON.stringify({ error: 'All answers must be non-empty strings' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const trimmedAnswer = answer.trim();
    if (trimmedAnswer.length === 0) {
      return new Response(JSON.stringify({ error: 'All answers must be non-empty strings' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const meta = questionMeta[index];
    const maxAllowedLength = Math.max(meta?.maxLength ?? 200, 150);
    if (trimmedAnswer.length > maxAllowedLength) {
      return new Response(JSON.stringify({ error: `第 ${index + 1} 题的答案字数超过限制（最多 ${maxAllowedLength} 字）` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    normalizedAnswers.push(trimmedAnswer);
  }

  try {
    // 直接调用AI生成，不再入队
    const magicalGirlDetails = await generateWithAI({ answers: normalizedAnswers, language }, magicalGirlDetailsConfig);

    // 异步保存到D1数据库，不阻塞对用户的响应
    // const saveData = {
    //   ...magicalGirlDetails,
    //   answers: answers
    // };

    // // 在Edge环境中，可以使用executionContext.waitUntil来确保异步任务完成
    // const executionContext = (req as any).context;
    // if (executionContext && typeof executionContext.waitUntil === 'function') {
    //   executionContext.waitUntil(saveToD1(saveData));
    // } else {
    //   // 在非Edge环境中，直接调用（不等待完成）
    //   saveToD1(saveData).catch(err => log.error('保存到D1失败（非阻塞）', err));
    // }

    // 将用户答案和生成结果合并，并添加模板ID，为签名做准备
    const dataToSign = {
        ...magicalGirlDetails,
        templateId: "魔法少女/心之花/魔法少女（问卷生成）", // 添加模板ID
        userAnswers: normalizedAnswers
    };

    // 为合并后的数据生成签名
    const signature = await generateSignature(dataToSign);

    // 将签名附加到最终结果中
    const finalResult = {
        ...dataToSign,
        signature: signature
    };

    return new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    log.error('生成魔法少女详细信息失败', { error, answersLength: normalizedAnswers.length });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败，当前服务器可能正忙，请稍后重试', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export default handler;
