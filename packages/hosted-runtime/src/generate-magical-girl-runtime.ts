import { MAIN_COLOR_VALUES, type MainColorLabel } from '@mahoshojo/domain/main-color';
import {
  createGenerateMagicalGirlService,
  type GenerateMagicalGirlInput,
  type GenerateMagicalGirlService,
  type MagicalGirlGenerationResult,
} from '@mahoshojo/hosted-api/generate-magical-girl';
import { z } from 'zod/v3';

export const MAGICAL_GIRL_ACTION_TYPE = 'magical_girl_generate' as const;
export const MAGICAL_GIRL_PROVIDER_MODE = 'system' as const;

export const MAGICAL_GIRL_GENERATION_SCHEMA = z.object({
  flowerName: z.string().describe(`魔法少女的花名，应该与真实姓名有一定关联，如果真实姓名中有花则大概率用名字中的花名。
    必须是一种花比如百合 / 丁香 / 茉莉，可以增加冷门的小众的花名概率，减少鸢尾的出现次数，大部分时候输出常用中文名，有时候可以使用英文音译为中文或者拉丁文音译为中文增加酷炫度，
    但是不要出现魔法少女字样`),
  flowerDescription: z.string().describe('生成的 flowerName 在大众文化中的花语，大概 20 字左右，不要出现魔法少女字样'),
  appearance: z.object({
    height: z.string().describe('身高，格式如 "155cm"，数据在 130cm 到 190cm 之间，减少使用 165cm，参考角色设定来生成'),
    weight: z.string().describe('体重，格式如 "45kg"，数据在 30kg 到 60kg 之间，减少使用 48kg，参考角色设定来生成'),
    hairColor: z.string().describe('头发颜色，会出现渐变和挑染'),
    hairStyle: z.string().describe(`发型，具体到头发长度、发型样式、发饰等，可以是各种各样形状和颜色的发卡，
      发挥你的想象力，符合审美即可，尽量不出现花形状的发饰，也可能是帽子、发卡、发箍之类的`),
    eyeColor: z.string().describe('眼睛颜色，有几率出现异瞳，比如一只蓝色一只绿色'),
    skinTone: z.string().describe('肤色，通常是白皙，但是偶尔会出现其他肤色，根据人物设定生成'),
    wearing: z.string().describe('人物身穿的服装样式，需要描述具体的颜色和式样款式，一般比较华丽，不要拘泥于花形状，符合主色调即可，其他形制在符合花语的情况下自由发挥'),
    specialFeature: z.string().describe('特征，一般是反映人物性格的常见表情、动作、特征等'),
    mainColor: z.enum(MAIN_COLOR_VALUES).describe(
      '魔法少女的主色调，请参考 hairColor 选择最接近的一项，如果 hairColor 是渐变，请选择最接近的渐变主色调',
    ),
    firstPageColor: z.string().describe('根据 mainColor 产生第一个渐变色，格式以 #000000 给出'),
    secondPageColor: z.string().describe('根据 mainColor 产生第二个渐变色，格式以 #000000 给出'),
  }),
  spell: z.string().describe(`很酷的变身咒语，提供日语版和对应的中文翻译，使用 \n 换行，参考常见的日本魔法少女中的变身，通常 20 字到 40 字左右。
    - 参考格式1：
        "黒よりも黒く、闇よりも暗い。ここに我が真の真紅の黄金の光を託す。目覚めの時が来た。不条理な教会の腐敗した論理" \n
        "比黑色更黑 比黑暗更暗的漆黑 在此寄讬吾真红的金光吧 觉醒之时的到来 荒谬教会的堕落章理"`),
});

export type AIGeneratedMagicalGirl = z.infer<typeof MAGICAL_GIRL_GENERATION_SCHEMA>;
export type MainColor = MainColorLabel;

export const MAGICAL_GIRL_SYSTEM_PROMPT = `你是一个专业的魔法少女角色设计师。请根据用户输入的真名，设计一个独特的魔法少女角色。
设计要求：
1. 魔法少女名字应该以花名为主题，要与用户的真名有某种关联性或呼应
2. 外貌特征要协调统一，符合魔法少女的设定
3. 变身咒语要朗朗上口，充满魔法感
请严格按照提供的 JSON schema 格式返回结果。`;

export const buildMagicalGirlGenerationPrompt = (
  { realName, language }: GenerateMagicalGirlInput,
): string => `请为名叫"${realName}"的人设计一个魔法少女角色。真实姓名：${realName}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;

export const MAGICAL_GIRL_GENERATION_CONFIG = Object.freeze({
  systemPrompt: MAGICAL_GIRL_SYSTEM_PROMPT,
  temperature: 0.8,
  promptBuilder: buildMagicalGirlGenerationPrompt,
  schema: MAGICAL_GIRL_GENERATION_SCHEMA,
  taskName: '生成魔法少女',
});

export type GenerateMagicalGirlAiOptions = {
  channelContext: {
    providerId: 'system';
    modelId: 'default';
  };
};

export interface GenerateMagicalGirlRuntimeDependencies {
  checkRateLimit(_input: {
    request: Request;
    actionType: typeof MAGICAL_GIRL_ACTION_TYPE;
    providerMode: typeof MAGICAL_GIRL_PROVIDER_MODE;
  }): Promise<Response | null>;
  enforceSafety(_input: {
    request: Request;
    name: string;
    language: string;
  }): Promise<Response | null>;
  generateWithAI(
    _input: GenerateMagicalGirlInput,
    _config: typeof MAGICAL_GIRL_GENERATION_CONFIG,
    _options: GenerateMagicalGirlAiOptions,
  ): Promise<AIGeneratedMagicalGirl>;
  sign(_payload: MagicalGirlGenerationResult & { templateId: string }): Promise<string | null>;
  recordActivity(_request: Request): void;
  logError(_error: unknown, _context: { name: string }): void;
  cooldownMs: number;
}

export interface GenerateMagicalGirlRuntime {
  readonly service: GenerateMagicalGirlService;
  readonly generateMagicalGirlWithAI: (
    _realName: string,
    _language: string,
  ) => Promise<AIGeneratedMagicalGirl>;
}

export const createGenerateMagicalGirlRuntime = (
  dependencies: GenerateMagicalGirlRuntimeDependencies,
): GenerateMagicalGirlRuntime => {
  const ports = Object.freeze({ ...dependencies });
  const generateMagicalGirlWithAI = (
    realName: string,
    language: string,
  ): Promise<AIGeneratedMagicalGirl> => ports.generateWithAI(
    { realName, language },
    MAGICAL_GIRL_GENERATION_CONFIG,
    {
      channelContext: {
        providerId: MAGICAL_GIRL_PROVIDER_MODE,
        modelId: 'default',
      },
    },
  );

  const service = createGenerateMagicalGirlService({
    checkRateLimit: (request) => ports.checkRateLimit({
      request,
      actionType: MAGICAL_GIRL_ACTION_TYPE,
      providerMode: MAGICAL_GIRL_PROVIDER_MODE,
    }),
    enforceSafety: (request, { name, language }) => ports.enforceSafety({
      request,
      name,
      language,
    }),
    generate: ({ realName, language }) => generateMagicalGirlWithAI(realName, language),
    sign: ports.sign,
    recordActivity: ports.recordActivity,
    logError: ports.logError,
    retryAfterSeconds: Math.ceil(ports.cooldownMs / 1000),
  });

  return Object.freeze({ service, generateMagicalGirlWithAI });
};
