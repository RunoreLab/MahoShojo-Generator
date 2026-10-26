import { buildNovelAIPromptRewriteInstruction, type NovelAIPromptRewriteOptions } from '@mahoshojo/ai-core/novelai';
export { NOVELAI_PROMPT_PROFILES, getNovelAIPromptProfile, buildNovelAIPromptRewriteInstruction, type NovelAIPromptRewriteOptions } from '@mahoshojo/ai-core/novelai';

import {
  AI_PROVIDER_PRESETS, describeAiPresetModelDirectSupport, listDirectCapableAiPresets,
  listDirectCapableAiPresetModels, resolveAIProviderModel, resolveAiPresetModelDirectBaseUrl,
} from '@mahoshojo/ai-core/provider-catalog';
import type { DirectProviderAdapter } from '@mahoshojo/contracts/provider-profile';
import { z } from 'zod';
import type { UserAIProviderConfig } from '@/lib/ai/custom-provider';

const textAdapters = new Set<DirectProviderAdapter>(['openai-compatible']);
export const NOVELAI_TEXT_PROVIDERS = listDirectCapableAiPresets(textAdapters).map((preset) => ({
  ...preset, models: listDirectCapableAiPresetModels(preset, textAdapters),
}));

const chatResponseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal('stop'),
    message: z.object({ content: z.string() }),
  })).min(1),
});

export async function rewriteNovelAIPrompt(
  config: UserAIProviderConfig,
  imageModel: string,
  sourcePrompt: string,
  signal: AbortSignal,
  options: NovelAIPromptRewriteOptions = {},
): Promise<string> {
  const provider = AI_PROVIDER_PRESETS.find((item) => item.id === config.providerId);
  const model = provider && resolveAIProviderModel(provider, config.modelId);
  if (!provider?.baseUrl || !model) throw new Error('请选择自备 Key 的文本供应商和模型');
  const direct = describeAiPresetModelDirectSupport(provider, model.modelId, textAdapters);
  if (!direct.supported) throw new Error('该文本模型尚不支持此处的直连协议，请选择已核验的 OpenAI-compatible 模型');
  const apiKey = config.apiKey.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error('请填写有效的文本模型 API Key');
  const prompt = sourcePrompt.trim();
  if (!prompt || prompt.length > 20_000) throw new Error('请填写要优化的提示词，且不超过 20,000 字符');
  const requirements = options.requirements?.trim() ?? '';
  if (requirements.length > 2_000) throw new Error('补充要求请控制在 2,000 字符以内');
  const system = buildNovelAIPromptRewriteInstruction(imageModel, options);
  // 出站端点取该模型已核验 Direct wire 的端点——可能与 preset.baseUrl 分属
  // 同一供应商的不同协议面（Google：Gemini 原生 baseUrl ↔ OpenAI-compat 面）。
  const directBaseUrl = resolveAiPresetModelDirectBaseUrl(provider, model.modelId);
  const baseURL = new URL(directBaseUrl ?? provider.baseUrl);
  if (baseURL.protocol !== 'https:' || baseURL.username || baseURL.password) throw new Error('文本供应商必须使用 HTTPS');

  let status: number | undefined;
  try {
    const base = baseURL.href.replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    // OpenAI reasoning models use a completion budget that includes reasoning tokens.
    const reasoning = provider.type === 'openai' && /^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/.test(model.modelId);
    // Gemini 的 OpenAI-compat 面按 OpenAI 现行参数名收 completion 预算。
    const budgetParam = reasoning || provider.type === 'google' ? 'max_completion_tokens' : 'max_tokens';
    const messages = [{ role: reasoning ? 'developer' : 'system', content: system }, {
      role: 'user', content: JSON.stringify({ source: prompt, visualRequirements: requirements }),
    }];
    signal.throwIfAborted();
    const response = await fetch(url, {
      method: 'POST', signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages,
        stream: false,
        [budgetParam]: 4096,
      }),
    });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Provider request failed');
    }
    let bytes = 0;
    // Bound chunked responses before parsing, even when Content-Length is absent.
    const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > 512 * 1024) throw new Error('Provider response too large');
        controller.enqueue(chunk);
      },
    }));
    const json: unknown = await new Response(body).json();
    const raw = chatResponseSchema.parse(json).choices[0].message.content.trim();
    // Accept a single accidental plain-text fence; compatibility rules run only in the LLM instruction.
    const text = raw.replace(/^```(?:text|plaintext)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
    signal.throwIfAborted();
    if (!text || text.length > 8_000) {
      throw new Error('Incomplete provider output');
    }
    return text;
  } catch {
    // Never expose raw provider errors, request bodies or keys in the UI.
    if (signal.aborted) throw new Error('已取消提示词优化；已提交的文本请求可能仍会计费');
    if (status === 401 || status === 403) throw new Error('文本模型鉴权失败，请检查对应供应商的 API Key');
    if (status === 429) throw new Error('文本模型请求受限，请稍后手动重试');
    throw new Error('提示词优化失败：请检查供应商是否支持浏览器跨域直连、网络和模型输出。未自动重试，原提示词已保留。');
  }
}
