import type { QuestionnaireAnswerItem } from '@mahoshojo/domain/questionnaire';
import {
  createGenerateCreatorService,
  type GenerateCreatorService,
} from '@mahoshojo/hosted-api/generate-creator';
import { completeStep, respondStep } from '@mahoshojo/hosted-api/regular-generation';
import { z } from 'zod/v3';

import {
  createCanshouGenerationConfig,
  type CanshouGeneratedData,
} from './canshou-generation-runtime-shared';
import {
  buildCreatorPromptText,
  isCreatorTemplateSupported,
  normalizeCreatorTemplate,
  type CreatorBuildRuleRuntimeResult,
  type CreatorDomainRuntimeDependencies,
  type CreatorPromptInput,
  type CreatorRequestInput,
  type CreatorTemplateId,
} from './creator-runtime-shared';
import {
  inferCustomProviderMode,
  type CustomProviderRuntimeDependencies,
  type CustomProviderRuntimeOptions,
} from './custom-provider-runtime';
import {
  type GenerationAiTelemetry,
  type StructuredGenerationConfig,
} from './generation-runtime-shared';
import {
  buildQuestionnaireLoreText,
  extractAnswerQuestionnaireIds,
  findOverLimitAnswer,
  normalizePresetEntries,
  normalizeQuestionnaireSelections,
  normalizeQuestionnaires,
  resolveAnswerItems,
  resolveNativeQuestionnaires,
  type QuestionnaireDataCard,
  type RequestQuestionnaire,
} from './questionnaire-generation-runtime';
import {
  compactQuestionnaireAnswerItems,
  formatQuestionnaireAnswers,
  resolveLegacyQuestionnaireProviderRuntime,
  type LegacyProviderRuntimeLogger,
} from './questionnaire-composition-runtime-shared';

export const CREATOR_MAGICAL_GIRL_ACTION_TYPE = 'magical_girl_details_generate' as const;
export const CREATOR_CANSHOU_ACTION_TYPE = 'canshou_generate' as const;

export const CREATOR_MAGICAL_GIRL_SCHEMA = z.object({
  codename: z.string().describe('代号：魔法少女对应的一种花的名字，根据性格、理念匹配合适的花语对应的花名。可以从我提供的花名中选取最合适的一个，也可以生成一个其他的更合适的花名。'),
  appearance: z.object({
    outfit: z.string().describe('魔法少女变身后的服装和饰品的详细描述，50字左右'),
    accessories: z.string().describe('变身后的饰品细节描述，50字左右'),
    colorScheme: z.string().describe('参考问卷生成主要色调和配色方案'),
    overallLook: z.string().describe('整体外观风格，包括发色、瞳色、发型、体型、服饰和神态表情，60字左右'),
  }),
  magicConstruct: z.object({
    name: z.string().describe('魔装的名字'),
    form: z.string().describe('魔装的具体形态和外观'),
    basicAbilities: z.array(z.string()).describe('魔装的基本能力列表，2-3个核心能力'),
    description: z.string().describe('魔装的详细描述和特色'),
  }),
  wonderlandRule: z.object({
    name: z.string().describe('奇境规则的名称'),
    description: z.string().describe('奇境规则的具体内容和效果'),
    tendency: z.string().describe('规则的倾向类型'),
    activation: z.string().describe('规则激活的条件或方式'),
  }),
  blooming: z.object({
    name: z.string().describe('繁开状态魔装名'),
    evolvedAbilities: z.array(z.string()).describe('繁开后的进化能力，2-3个强化能力'),
    evolvedForm: z.string().describe('繁开后的魔装形态变化'),
    evolvedOutfit: z.string().describe('繁开后的魔法少女衣装样式'),
    powerLevel: z.string().describe('繁开状态的力量等级描述'),
  }),
  analysis: z.object({
    personalityAnalysis: z.string().describe('基于问卷回答的性格分析'),
    abilityReasoning: z.string().describe('能力设定的推理过程和依据'),
    coreTraits: z.array(z.string()).describe('核心性格特征，3-4个关键词'),
    predictionBasis: z.string().describe('预测的主要依据和逻辑'),
    background: z.object({
      belief: z.string().describe('角色的核心理念、信条或愿望，描述角色为何而战，支撑角色行动的内在动力。'),
      bonds: z.string().describe('角色的情感、羁绊，描述角色与他人（特别是在问卷中出现的人）之间的关系，以及这段关系如何影响了角色，羁绊会如何影响其成长的旅途。'),
    }).describe('角色的背景故事，用以丰富角色的立体形象与人物弧光，体现角色的信念与感情。'),
  }),
});

export type CreatorMagicalGirlData = z.infer<typeof CREATOR_MAGICAL_GIRL_SCHEMA>;
export type CreatorStructuredData = CreatorMagicalGirlData | CanshouGeneratedData;

type CreatorStructuredGenerationInput = {
  answers: QuestionnaireAnswerItem[];
  language: string;
  loreText: string;
  creatorPromptText: string;
};

const createMagicalGirlGenerationConfig = (
  getRandomFlowers: () => string,
  modelOverride: string | undefined,
  generationSettingsContext: CustomProviderRuntimeOptions['generationSettingsContext'],
): StructuredGenerationConfig<CreatorMagicalGirlData, CreatorStructuredGenerationInput> => ({
  systemPrompt: `你是魔法国度的妖精，你准备通过问卷调查的形式，事先通过问卷结果分析某人成为魔法少女后的能力等各项素质。魔法少女的性格倾向、经历背景、行事准则等等都会影响到她们在魔法少女道路上的潜力和表现。
以下是一位潜在魔法少女对问卷所给出的回答（对方可以不回答某些问题），请你据此预测她成为魔法少女后的情况。

你需要严格按照提供的 JSON schema 格式返回你的预测结果和相应的解释内容，结果中的内容解释如下。
1.魔力构装（简称魔装）：魔法少女的本相魔力所孕育的能力具现，是魔法少女能力体系的基础。一般呈现为魔法少女在现实生活中接触过，在冥冥之中与其命运关联或映射的物体，并且与魔法少女特色能力相关。例如，泡泡机形态的魔装可以使魔法少女制造魔法泡泡，而这些泡泡可以拥有产生幻象、缓冲防护、束缚困敌等能力。这部分的内容需包含魔装的名字（通常为2字词），魔装的形态，魔装的基本能力。
2.奇境规则：魔法少女的本相灵魂所孕育的能力，是魔装能力的一体两面。奇境是魔装能力在规则层面上的升华，体现为与魔装相关的规则领域，而规则的倾向则会根据魔法少女的倾向而有不同的发展。例如，泡泡机形态的魔装升华而来的奇境规则可以是倾向于守护的“戳破泡泡的东西将会立即无效化”，也可以是倾向于进攻的“沾到身上的泡泡被戳破会立即遭受伤害”。
3.繁开：是魔法少女魔装能力的二段进化与解放，无论是作为魔法少女的魔力衣装还是魔装的武器外形都会发生改变。需包含繁开状态魔装名（需要包含原魔装名的每个字），繁开后的进化能力，繁开后的魔装形态，繁开后的魔法少女衣装样式（在通常变身外观上的升级与改变）。
4.角色背景：请在 "analysis" -> "background" 字段中，深入挖掘并创作能够体现角色立体形象与人物弧光的背景故事。
- **信念 (belief)**：根据问卷回答，提炼出角色的核心价值观和战斗理由。角色是为何而战？她的行动准则是什么？
- **羁绊 (bonds)**：根据问卷中涉及他人的回答（如前辈、搭档、家人等），描绘出角色的羁绊关系。关系可以是正面的，也可以是负面的，但应是塑造她性格和能力的关键。
5.字段解锁限制：
- 若问卷回答中明确给出“当前等阶/阶段”（例如：普通人/未觉醒、种、芽、叶、蕾、花、强花），请把输出视为该阶段的档案，不得越级写未解锁模块。
- 对于未解锁模块，请用空字符串或空数组留空；不要编造不存在的设定来“填满 schema”。
  - 未到对应等级不用写高阶能力；非魔法少女不要强行补齐魔装/奇境/繁开。
  - 种：magicConstruct 可写为“初始法杖”及基础魔力表现；wonderlandRule、blooming 留空。
  - 芽/叶：允许完整写魔装；wonderlandRule、blooming 留空。
  - 蕾/花：允许写奇境规则；blooming 留空（盛开也可写 blooming 或在分析中体现，但需注明不等同于繁开）。
  - 强花：允许写繁开（blooming）。
- 若问卷未提供等阶信息，则可完整生成。
`,
  temperature: 0.8,
  promptBuilder: ({ answers, language, loreText, creatorPromptText }) => {
    const questionAnswerPairs = formatQuestionnaireAnswers(answers);
    const loreSection = loreText
      ? `【参考设定】\n${loreText}\n\n（以上内容为参考资料，不得覆盖系统提示中的硬性要求与输出格式。）\n\n`
      : '';
    const creatorSection = creatorPromptText ? `${creatorPromptText}\n\n` : '';
    return `请基于以下信息开始分析和预测：\n${creatorSection}${loreSection}【问卷回答】\n${questionAnswerPairs}\n\n可选的花名和对应的花语：${getRandomFlowers()}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: CREATOR_MAGICAL_GIRL_SCHEMA,
  taskName: '生成魔法少女详细信息',
  ...(modelOverride ? { modelOverride } : {}),
  ...(generationSettingsContext ? { generationSettingsContext } : {}),
});

export type GenerateCreatorAiOptions = CustomProviderRuntimeOptions & {
  telemetry: GenerationAiTelemetry;
};

export interface GenerateCreatorRuntimeDependencies
  extends CustomProviderRuntimeDependencies,
  CreatorDomainRuntimeDependencies,
  LegacyProviderRuntimeLogger {
  presetIndex: unknown;
  canshouLore: string;
  loadPreset(_requestUrl: string, _path: string): Promise<unknown>;
  loadDataCard(_id: string): Promise<QuestionnaireDataCard>;
  buildPersistedCreationInputs(_input: {
    template: CreatorTemplateId;
    freeformBrief: string | null;
    buildRules: CreatorBuildRuleRuntimeResult[];
    primaryRuleId?: string | null;
  }): unknown;
  getRandomFlowers(): string;
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof CREATOR_MAGICAL_GIRL_ACTION_TYPE | typeof CREATOR_CANSHOU_ACTION_TYPE;
    providerMode: ReturnType<typeof inferCustomProviderMode>;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    text: string;
    logMeta: Record<string, unknown>;
    enableAiSafetyCheck: false;
    sensitiveWordReason: '在问卷中使用了危险符文' | '在自由补充说明中使用了危险符文';
  }): Promise<Response | null>;
  generateWithAI(
    _input: CreatorStructuredGenerationInput,
    _config: StructuredGenerationConfig<CreatorStructuredData, CreatorStructuredGenerationInput>,
    _options: GenerateCreatorAiOptions,
  ): Promise<CreatorStructuredData>;
  sign(_payload: Record<string, unknown>): Promise<unknown>;
  recordActivity(_request: Request): void;
  buildResponse(_input: {
    requestHeaders: Headers;
    data: Record<string, unknown>;
    telemetry: GenerationAiTelemetry;
  }): Response | Promise<Response>;
  logInfo(_message: string, _meta: unknown): void;
  logError(_error: unknown, _input?: { normalizedAnswers: QuestionnaireAnswerItem[]; template: CreatorTemplateId }): void;
}

export interface GenerateCreatorRuntime {
  readonly service: GenerateCreatorService;
}

type CreatorPreparedInput = {
  normalizedAnswers: QuestionnaireAnswerItem[];
  effectiveQuestionnaires: RequestQuestionnaire[];
  allowNativeSignature: boolean;
  language: string;
  customProviderPayload: unknown;
  template: CreatorTemplateId;
  freeformBrief: string | null;
  primaryRuleId: string | null;
  buildRules: CreatorBuildRuleRuntimeResult[];
  creatorPromptInput: CreatorPromptInput;
};

type CreatorGeneration = {
  structuredResult: CreatorStructuredData;
  aiTelemetry: GenerationAiTelemetry;
};

export const createGenerateCreatorRuntime = (
  dependencies: GenerateCreatorRuntimeDependencies,
): GenerateCreatorRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const presetEntries = normalizePresetEntries(ports.presetIndex);
  const service = createGenerateCreatorService<
    CreatorPreparedInput,
    Exclude<ReturnType<typeof resolveLegacyQuestionnaireProviderRuntime>, { response: Response }>,
    CreatorGeneration
  >({
    prepare: async (request, body) => {
      const requestBody = body as Record<string, unknown>;
      const rawAnswers = requestBody.answers;
      const requestedNativeSignature = requestBody.allowNativeSignature === true;
      const questionnaireSelections = normalizeQuestionnaireSelections(
        requestBody.questionnaireSelections,
      );
      const requiredQuestionnaireIds = extractAnswerQuestionnaireIds(rawAnswers);
      const language = typeof requestBody.language === 'string' && requestBody.language.trim()
        ? requestBody.language.trim()
        : 'zh-CN';
      const template = normalizeCreatorTemplate(requestBody.template, 'non-stream');
      const freeformBrief = typeof requestBody.freeformBrief === 'string'
        ? requestBody.freeformBrief
        : null;
      const primaryRuleId = typeof requestBody.primaryRuleId === 'string'
        && requestBody.primaryRuleId.trim()
        ? requestBody.primaryRuleId.trim()
        : null;
      let effectiveQuestionnaires = normalizeQuestionnaires(requestBody.questionnaires);
      let nativeAllowedByServer = false;
      if (requestedNativeSignature) {
        try {
          const resolved = await resolveNativeQuestionnaires({
            requestUrl: request.url,
            selections: questionnaireSelections,
            requiredQuestionnaireIds,
            presetEntries,
            loadPreset: ports.loadPreset,
            loadDataCard: ports.loadDataCard,
          });
          if (resolved.allowed && resolved.questionnaires.length > 0) {
            nativeAllowedByServer = true;
            effectiveQuestionnaires = resolved.questionnaires;
          } else {
            ports.logInfo('请求原生签名但问卷未获原生许可，已取消原生签名', {
              selectionCount: questionnaireSelections.length,
            });
          }
        } catch (error) {
          ports.logWarn('尝试解析原生许可问卷失败，已取消原生签名', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const normalizedAnswers = resolveAnswerItems(rawAnswers, effectiveQuestionnaires, {
        preferResolvedQuestionText: nativeAllowedByServer,
      });
      const overLimitAnswer = findOverLimitAnswer(normalizedAnswers, effectiveQuestionnaires);
      const allowNativeSignature = requestedNativeSignature
        && nativeAllowedByServer
        && !overLimitAnswer;
      if (overLimitAnswer) {
        ports.logInfo('问卷答案超过字数上限，已取消原生签名', overLimitAnswer);
      }

      try {
        const buildRules = ports.resolveBuildRules(requestBody.buildRules);
        const creatorRequestInput: CreatorRequestInput = {
          template,
          freeformBrief,
          questionnaires: effectiveQuestionnaires.map((questionnaire) => ({
            questionnaireId: questionnaire.id,
            title: questionnaire.title,
          })),
          questionnaireAnswers: normalizedAnswers,
          buildRules,
          primaryRuleId,
        };
        if (!isCreatorTemplateSupported('non-stream', template)) {
          throw new Error('CREATOR_TEMPLATE_MODE_UNSUPPORTED');
        }
        ports.validateCreatorRequest(creatorRequestInput);
        const creatorPromptInput = ports.buildCreatorPromptInput(creatorRequestInput);
        return completeStep({
          normalizedAnswers,
          effectiveQuestionnaires,
          allowNativeSignature,
          language,
          customProviderPayload: requestBody.customProvider,
          template,
          freeformBrief,
          primaryRuleId,
          buildRules,
          creatorPromptInput,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'CREATOR_REQUEST_INVALID';
        return respondStep(new Response(JSON.stringify({ error: '创作请求无效', message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    },
    resolveExecution: async (_request, input) => {
      const resolved = resolveLegacyQuestionnaireProviderRuntime(
        input.customProviderPayload,
        ports,
      );
      return resolved.response ? respondStep(resolved.response) : completeStep(resolved);
    },
    checkRateLimit: (request, input) => ports.checkRateLimit({
      request,
      actionType: input.template === 'canshou'
        ? CREATOR_CANSHOU_ACTION_TYPE
        : CREATOR_MAGICAL_GIRL_ACTION_TYPE,
      providerMode: inferCustomProviderMode(input.customProviderPayload),
    }),
    enforceSafety: async (request, input) => {
      for (const answerItem of input.normalizedAnswers) {
        const response = await ports.enforceSafety({
          request,
          text: answerItem.answer,
          logMeta: {
            questionId: answerItem.questionId,
            questionnaireId: answerItem.questionnaireId,
          },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在问卷中使用了危险符文',
        });
        if (response) return response;
      }
      return input.creatorPromptInput.userIntent
        ? ports.enforceSafety({
          request,
          text: input.creatorPromptInput.userIntent,
          logMeta: { source: 'freeformBrief', template: input.template },
          enableAiSafetyCheck: false,
          sensitiveWordReason: '在自由补充说明中使用了危险符文',
        })
        : null;
    },
    generate: async (_request, input, execution) => {
      const aiTelemetry: GenerationAiTelemetry = {};
      const creatorPromptText = buildCreatorPromptText(input.creatorPromptInput);
      const generationInput: CreatorStructuredGenerationInput = {
        answers: input.normalizedAnswers,
        language: input.language,
        loreText: buildQuestionnaireLoreText(input.effectiveQuestionnaires),
        creatorPromptText,
      };
      const options: GenerateCreatorAiOptions = {
        ...execution.options,
        telemetry: aiTelemetry,
      };
      const structuredResult = input.template === 'canshou'
        ? await ports.generateWithAI(
          generationInput,
          createCanshouGenerationConfig(
            ports.canshouLore,
            execution.modelOverride,
            execution.options.generationSettingsContext,
          ) as StructuredGenerationConfig<CreatorStructuredData, CreatorStructuredGenerationInput>,
          options,
        )
        : await ports.generateWithAI(
          generationInput,
          createMagicalGirlGenerationConfig(
            ports.getRandomFlowers,
            execution.modelOverride,
            execution.options.generationSettingsContext,
          ) as StructuredGenerationConfig<CreatorStructuredData, CreatorStructuredGenerationInput>,
          options,
        );
      return completeStep({ structuredResult, aiTelemetry });
    },
    recordActivity: ports.recordActivity,
    buildResponse: async (request, input, output) => {
      const creationInputs = ports.buildPersistedCreationInputs({
        template: input.template,
        freeformBrief: input.freeformBrief,
        buildRules: input.buildRules,
        ...(input.primaryRuleId ? { primaryRuleId: input.primaryRuleId } : {}),
      });
      const buildState = input.buildRules.length > 0
        ? {
          ...(input.primaryRuleId ? { primaryRuleId: input.primaryRuleId } : {}),
          rules: input.buildRules,
        }
        : undefined;
      const dataToSign: Record<string, unknown> = {
        ...output.structuredResult,
        templateId: input.template === 'canshou'
          ? '魔法少女/心之花/残兽（问卷生成）'
          : '魔法少女/心之花/魔法少女（问卷生成）',
        userAnswers: compactQuestionnaireAnswerItems(input.normalizedAnswers),
        creationInputs,
        ...(buildState ? { buildState } : {}),
      };
      const data = input.allowNativeSignature
        ? { ...dataToSign, signature: await ports.sign(dataToSign) }
        : dataToSign;
      return ports.buildResponse({
        requestHeaders: request.headers,
        data,
        telemetry: output.aiTelemetry,
      });
    },
    logError: ports.logError,
  });

  return Object.freeze({ service });
};
