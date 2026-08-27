import { z } from 'zod';
import {
  buildHostedGenerationErrorPayload,
  createSafeHostedGenerationError,
} from './regular-generation';

export const MAGICAL_GIRL_NAME_MAX_LENGTH = 300;
export const MAGICAL_GIRL_TEMPLATE_ID = '魔法少女/心之花/魔法少女（名字生成）';

const GenerateMagicalGirlRequestSchema = z.object({
  name: z.string().trim().min(1).max(MAGICAL_GIRL_NAME_MAX_LENGTH),
  language: z.string().trim().min(1).max(32).optional().default('zh-CN'),
});

export type MagicalGirlGenerationResult = {
  flowerName: string;
  flowerDescription: string;
  appearance: {
    height: string;
    weight: string;
    hairColor: string;
    hairStyle: string;
    eyeColor: string;
    skinTone: string;
    wearing: string;
    specialFeature: string;
    mainColor: string;
    firstPageColor: string;
    secondPageColor: string;
  };
  spell: string;
};

export type GenerateMagicalGirlInput = {
  realName: string;
  language: string;
};

export interface GenerateMagicalGirlServiceDependencies {
  checkRateLimit(_request: Request): Promise<Response | null>;
  enforceSafety(
    _request: Request,
    _input: { name: string; language: string },
  ): Promise<Response | null>;
  generate(_input: GenerateMagicalGirlInput): Promise<MagicalGirlGenerationResult>;
  sign(_payload: MagicalGirlGenerationResult & { templateId: string }): Promise<string | null>;
  recordActivity(_request: Request): void;
  logError(_error: unknown, _context: { nameLength: number }): void;
  retryAfterSeconds: number;
}

export interface GenerateMagicalGirlService {
  (_request: Request): Promise<Response>;
}

const jsonResponse = (payload: unknown, status: number): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: { 'Content-Type': 'application/json' },
  },
);

export const createGenerateMagicalGirlService = (
  dependencies: GenerateMagicalGirlServiceDependencies,
): GenerateMagicalGirlService => async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const parsedBody = GenerateMagicalGirlRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsedBody.success) {
    const hasTooLongName = parsedBody.error.issues.some(
      (issue) => issue.path[0] === 'name' && issue.code === 'too_big',
    );
    return jsonResponse({
      error: hasTooLongName ? '名字太长啦，你怎么回事！' : 'Name is required',
    }, 400);
  }

  const { name, language } = parsedBody.data;
  const rateLimitResponse = await dependencies.checkRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const safetyResponse = await dependencies.enforceSafety(request, { name, language });
  if (safetyResponse) return safetyResponse;

  try {
    const magicalGirlData = await dependencies.generate({ realName: name, language });
    dependencies.recordActivity(request);

    const dataToSign = {
      ...magicalGirlData,
      templateId: MAGICAL_GIRL_TEMPLATE_ID,
    };
    const signature = await dependencies.sign(dataToSign);

    return jsonResponse({
      ...dataToSign,
      signature,
    }, 200);
  } catch (error) {
    dependencies.logError(createSafeHostedGenerationError(error), { nameLength: name.length });
    return jsonResponse({
      ...buildHostedGenerationErrorPayload(
        error,
        '生成失败，当前服务器可能正忙，请稍后重试',
      ),
      retryAfterSeconds: dependencies.retryAfterSeconds,
    }, 500);
  }
};
