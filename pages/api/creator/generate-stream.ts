import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import {
  buildCreatorGenerationArtifacts,
  normalizeCreatorBuildRules,
  normalizeCreatorRequestError,
  validateCreatorRequest,
} from '@/lib/creator/server';
import { CREATOR_TEMPLATE_IDS, isCreatorStreamTemplate } from '@/lib/creator/templates';
import type { CreatorRequestInput } from '@/lib/creator/types';
import { CreatorBuildRuleSnapshotSchema } from '@/lib/schemas/creator-metadata';
import generateFreeStreamHandler from '@/pages/api/generate-free-stream';

export const config = {
  runtime: 'edge',
};

const CreatorQuestionnaireSchema = z
  .object({
    questionnaireId: z.string().min(1),
    title: z.string().optional(),
  })
  .passthrough();

const CreatorQuestionnaireAnswerSchema = z
  .object({
    questionnaireId: z.string().optional(),
    question: z.string().optional(),
    answer: z.string().optional(),
  })
  .passthrough();

const CreatorRequestBodySchema = z.object({
  template: z.enum(CREATOR_TEMPLATE_IDS),
  freeformBrief: z.string().nullable().optional(),
  questionnaires: z.array(CreatorQuestionnaireSchema).default([]),
  questionnaireAnswers: z.array(CreatorQuestionnaireAnswerSchema).default([]),
  buildRules: z.array(CreatorBuildRuleSnapshotSchema).default([]),
  primaryRuleId: z.string().nullable().optional(),
  language: z.string().optional().default('zh-CN'),
  customProvider: z.unknown().optional(),
});

const jsonResponse = (body: Record<string, unknown>, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const buildForwardHeaders = (headers: Headers): Headers => {
  const forwarded = new Headers(headers);
  forwarded.set('Content-Type', 'application/json');
  return forwarded;
};

const buildForwardUrl = (requestUrl: string, pathname: string): string => {
  const url = new URL(requestUrl);
  url.pathname = pathname;
  return url.toString();
};

const buildCreatorValidationErrorResponse = (error: unknown): Response | null => {
  const normalized = normalizeCreatorRequestError(error);
  if (!normalized) {
    return null;
  }

  return jsonResponse(
    {
      error: normalized.code,
      ...(normalized.ruleId ? { ruleId: normalized.ruleId } : {}),
    },
    400
  );
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const parsedBody = CreatorRequestBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return jsonResponse({ error: '请求参数无效' }, 400);
    }

    const {
      template,
      freeformBrief,
      questionnaires,
      questionnaireAnswers,
      buildRules,
      primaryRuleId,
      language,
      customProvider,
    } = parsedBody.data;
    const normalizedBuildRules = normalizeCreatorBuildRules(buildRules);

    if (!isCreatorStreamTemplate(template)) {
      return jsonResponse({ error: 'STREAM_TEMPLATE_UNSUPPORTED' }, 400);
    }

    const creatorInput: CreatorRequestInput = {
      template,
      freeformBrief,
      questionnaires,
      questionnaireAnswers,
      buildRules: normalizedBuildRules,
      primaryRuleId,
    };

    try {
      validateCreatorRequest(creatorInput);
    } catch (error) {
      const validationResponse = buildCreatorValidationErrorResponse(error);
      if (validationResponse) {
        return validationResponse;
      }
      throw error;
    }

    const artifacts = buildCreatorGenerationArtifacts(creatorInput);
    const downstreamRequest = new Request(
      buildForwardUrl(req.url, '/api/generate-free-stream'),
      {
        method: 'POST',
        headers: buildForwardHeaders(req.headers),
        body: JSON.stringify({
          schema: template,
          prompt: artifacts.prompt,
          attachments: [],
          language,
          ...(customProvider ? { customProvider } : {}),
        }),
      }
    );

    return generateFreeStreamHandler(downstreamRequest as NextRequest);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return jsonResponse(
      {
        error: '生成失败',
        message: errorMessage,
      },
      500
    );
  }
}
