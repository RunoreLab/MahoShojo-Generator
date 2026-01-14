import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { FREE_GENERATION_ATTACHMENT_LIMITS, formatReferenceAttachmentsForPrompt, type AITextAttachment } from '@/lib/ai/attachments';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { CANSHOU_LORE } from '@/lib/canshou-lore';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';

const log = getLogger('api-tavern-convert-stream');

export const config = {
  runtime: 'edge',
};

const MAX_SAFETY_TEXT_CHARS = 50_000;

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

const AttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().optional().default('application/octet-stream'),
  size: z.number().int().nonnegative().optional(),
  content: z.string().max(FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsPerFile),
  truncated: z.boolean().optional(),
});

const AttachmentsSchema = z
  .array(AttachmentSchema)
  .max(FREE_GENERATION_ATTACHMENT_LIMITS.maxCount)
  .optional()
  .default([])
  .superRefine((items, ctx) => {
    const total = items.reduce((sum, item) => sum + item.content.length, 0);
    if (total > FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `附件内容总长度超出限制（上限 ${FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal.toLocaleString()} 字符）`,
      });
    }
  });

const TemplateSchema = z.enum(['magical-girl', 'canshou', 'general']);
type Template = z.infer<typeof TemplateSchema>;

const RequestBodySchema = z.object({
  template: TemplateSchema,
  sourceName: z.string().optional().default(''),
  attachments: AttachmentsSchema,
  language: z.string().optional().default('zh-CN'),
  customProvider: CustomProviderSchema.optional(),
});

const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const buildPrompt = (params: { template: Template; language: string; sourceName: string; attachments: AITextAttachment[] }): string => {
  const attachmentSection = formatReferenceAttachmentsForPrompt(params.attachments);
  const sourceName = params.sourceName.trim();
  const nameHint = sourceName ? `原角色名为「${sourceName}」。` : '原角色名未提供。';

  if (params.template === 'canshou') {
    return `
你是一名魔法国度研究院的残兽研究学者。你将根据【参考附件】中的角色资料，为本项目世界观生成一份【残兽档案】（Markdown）。

输出要求：
1) 必须使用【${params.language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写残兽名称或代号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 名称：...
   - 核心概念：...
   - 核心情感：...
   - 进化阶段：...

残兽世界观设定（必须严格遵守）：
${CANSHOU_LORE}

写作要求：
- ${nameHint}
- 尽量“保真”：保留角色核心概念、行为准则、口癖与关系线；若与本世界观冲突，可做“设定翻译”，但不要丢失核心人格。
- 文末以“研究员笔记”收束，给出危险评估与应对建议。

${attachmentSection}
`.trim();
  }

  if (params.template === 'magical-girl') {
    return `
你是魔法国度的妖精。你将根据【参考附件】中的角色资料，为本项目世界观生成一份【魔法少女档案】（Markdown），风格尽量贴近“问卷生成”产物。

输出要求：
1) 必须使用【${params.language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写代号/称号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 代号：...
   - 名字：...
5) 正文建议包含：外观、性格与信念、羁绊、能力与限制、战斗风格、魔装、奇境规则、繁开形态、关键经历、成长方向。

世界观关键概念（必须遵守）：
- 魔装：命运映射的物体与能力具现。
- 奇境规则：魔装能力在规则层面的升华。
- 繁开：二段进化与解放，魔装与衣装发生改变。

写作要求：
- ${nameHint}
- 尽量“保真”：保留角色核心身份、动机、口癖与关系线；若与本世界观冲突，可在不改变核心人格的前提下做“设定翻译”。

${attachmentSection}
`.trim();
  }

  return `
你是一个角色设定整理助手。你将根据【参考附件】中的 SillyTavern 角色资料，生成一份【通用角色卡正文】（Markdown）。

输出要求：
1) 必须使用【${params.language}】创作。
2) 必须直接输出 Markdown 正文，不要输出任何解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写角色名或代号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 代号：...
   - 名字：...

写作要求：
- ${nameHint}
- 尽量保留 description/personality/scenario/first_mes/mes_example/tags 等信息。
- 适当润色，但不要编造关键背景。

${attachmentSection}
`.trim();
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsedBody = RequestBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: '请求参数无效' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { template, sourceName, attachments, language, customProvider: customProviderPayload } = parsedBody.data;

    const combinedForSafety = [sourceName, ...attachments.map((item) => item.content)].filter((t) => t.trim()).join('\n\n');
    const safetyText = combinedForSafety.length > MAX_SAFETY_TEXT_CHARS ? combinedForSafety.slice(0, MAX_SAFETY_TEXT_CHARS) : combinedForSafety;
    const safetyResponse = await enforceTextSafety({
      text: safetyText,
      log,
      logMeta: { template, attachmentsCount: attachments.length, attachmentsChars: combinedForSafety.length },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'free',
    });
    if (safetyResponse) return safetyResponse;

    let customProviderOverride: AIProvider | null = null;
    let customProviderId: string | null = null;
    let customModelOverride: string | undefined;

    if (customProviderPayload) {
      const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
      if (!parsedResult.success) {
        log.warn('自定义 AI 供应商配置校验失败', { providerId: (customProviderPayload as any)?.providerId });
        return new Response(JSON.stringify({ error: '自定义 AI 供应商配置无效' }), { status: 400 });
      }

      const parsed = parsedResult.data;
      customProviderId = parsed.providerId;
      const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }

      const modelConfig = providerConfig.models.find((model) => model.value === parsed.modelId);
      if (!modelConfig) {
        return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
      }

      const sanitizedApiKey = parsed.apiKey.trim();
      if (!sanitizedApiKey && providerConfig.id !== 'system') {
        return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
      }

      const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
      if (!sanitizedBaseUrl) {
        customModelOverride = modelConfig.value;
        log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
          providerId: providerConfig.id,
          model: modelConfig.value,
        });
      } else {
        customProviderOverride = {
          name: providerConfig.name,
          apiKey: sanitizedApiKey,
          baseUrl: sanitizedBaseUrl,
          model: modelConfig.value,
          type: providerConfig.type,
          mode: providerConfig.mode || 'auto',
          retryCount: 1,
          skipProbability: 0,
        };
      }
    }

    const prompt = buildPrompt({ template, language, sourceName, attachments });

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions: GenerateWithAIOptions | undefined = (customProviderOverride || shouldDisablePolling)
      ? {
          ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
          ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
        }
      : undefined;

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: 0.75,
        maxOutputTokens: 4096,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      providerOptions
    );

    return streamResult.response;
  } catch (error) {
    log.error('酒馆导入流式转换失败', { error });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

