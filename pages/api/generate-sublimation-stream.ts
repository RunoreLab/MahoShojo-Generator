// pages/api/generate-sublimation-stream.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';

const log = getLogger('api-gen-sublimation-stream');

export const config = {
  runtime: 'edge',
};

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

const pruneLargeFieldsForPrompt = (data: Record<string, unknown>): Record<string, unknown> => {
  const cloned: Record<string, unknown> = { ...data };
  const largeKeys = [
    'arena_history',
    'adjudicationEvents',
    'signature',
    'metadata',
    'extraJson',
    'extra_json',
    'updatedAt',
    'updated_at',
    'createdAt',
    'created_at',
  ];
  for (const key of largeKeys) {
    if (key in cloned) delete cloned[key];
  }
  return cloned;
};

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const {
      language = 'zh-CN',
      userGuidance = '',
      narrativeHistory = '',
      fieldsToPreserve = [],
      isDowngrade = false,
      allowReshapeNames = false,
      customProvider: customProviderPayload,
      targetTemplate,
      sourceTemplate,
      ...originalCharacterData
    } = body ?? {};

    const finalUserGuidance = typeof userGuidance === 'string' ? userGuidance.trim().slice(0, 4000) : '';
    const finalNarrativeHistory = typeof narrativeHistory === 'string' ? narrativeHistory.trim().slice(0, 8000) : '';
    const normalizedFieldsToPreserve = Array.isArray(fieldsToPreserve)
      ? fieldsToPreserve.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, 64)
      : [];

    if (!originalCharacterData || typeof originalCharacterData !== 'object' || Object.keys(originalCharacterData).length === 0) {
      return new Response(JSON.stringify({ error: '角色数据卡不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const checkText = `${JSON.stringify(originalCharacterData)} ${finalUserGuidance} ${finalNarrativeHistory}`;
    const safetyResponse = await enforceTextSafety({
      text: checkText,
      log,
      enableAiSafetyCheck: false,
      sensitiveWordReason: '上传的角色档案或引导内容包含危险符文',
    });
    if (safetyResponse) return safetyResponse;

    let customProviderOverride: AIProvider | null = null;
    let customProviderId: string | null = null;
    let customModelOverride: string | undefined;

    if (customProviderPayload) {
      const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
      if (!parsedResult.success) {
        log.warn('自定义 AI 供应商配置校验失败', { providerId: customProviderPayload?.providerId, issues: parsedResult.error.issues });
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

    const identityHint =
      typeof (originalCharacterData as any).codename === 'string'
        ? String((originalCharacterData as any).codename).trim()
        : typeof (originalCharacterData as any).name === 'string'
          ? String((originalCharacterData as any).name).trim()
          : '';

    const promptSource = pruneLargeFieldsForPrompt(originalCharacterData as Record<string, unknown>);
    const sourceJson = JSON.stringify(promptSource, null, 2);

    const downgradedLabel = isDowngrade ? '（本次为“降级/退化”方向）' : '';
    const templateHintText = [
      typeof sourceTemplate === 'string' && sourceTemplate.trim() ? `- 来源模板: ${sourceTemplate.trim()}` : null,
      typeof targetTemplate === 'string' && targetTemplate.trim() ? `- 目标模板: ${targetTemplate.trim()}` : null,
      `- 允许重塑名称: ${allowReshapeNames === true ? '是' : '否'}`,
      `- 叙事历史: ${finalNarrativeHistory ? '已提供' : '未提供'}`,
      normalizedFieldsToPreserve.length > 0 ? `- 勾选保留字段: ${normalizedFieldsToPreserve.join('、')}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `
你是一位资深的角色设定师。你的任务是为一个角色进行“成长升华”。
你需要基于其完整的设定和所有“历战记录”（如有），对其进行一次全面的重塑和升级，以体现其成长与蜕变。
${downgradedLabel}

【重要】输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出“我将要/我不能”之类的解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写“升华后”的角色档案标题（优先代号/称号，不超过 30 字）。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”），例如：
   - 代号（如有）：...
   - 名字：...
5) 正文必须包含一个“升华事件”小节，给出事件标题与对角色变化的说明（不需要结构化 JSON）。
6) 若用户勾选了“保留字段”，请不要推翻其既有设定，应当保留原文。

【模板与约束提示】
${templateHintText || '（无）'}

【原角色数据卡（JSON，已裁剪大字段）】
${sourceJson}

【用户引导】
${finalUserGuidance || '（无）'}

【叙事历史（用户补充）】
${finalNarrativeHistory || '（无）'}

【附加提示】
${identityHint ? `角色当前标识：${identityHint}` : '（无）'}
`.trim();

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
        temperature: 0.7,
        maxOutputTokens: 4096,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      providerOptions
    );

    return streamResult.response;
  } catch (error) {
    log.error('流式升华失败', { error });
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;
