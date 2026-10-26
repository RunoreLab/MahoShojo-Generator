import { z } from 'zod';
import { NOVELAI_MODELS, parseNovelAISettings, type NovelAISettings } from '@mahoshojo/ai-core/novelai';

export { DEFAULT_NOVELAI_SETTINGS, NOVELAI_MODELS, NOVELAI_SIZES, type NovelAISettings } from '@mahoshojo/ai-core/novelai';

export const normalizeNovelAIToken = (value: string) => value.trim().replace(/^Bearer\s+/i, '').trim();

export function resolveNovelAIEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.trim() || 'https://image.novelai.net');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/ai/generate-image`;
    return url.href;
  } catch {
    throw new Error('请填写有效的 NovelAI Base URL（HTTP/HTTPS，不含账号密码、查询参数或片段）');
  }
}

const responseSchema = z.object({
  images: z.array(z.object({
    image: z.string().min(12).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    seed: z.number().int().min(0).max(0xffffffff).optional(),
  })).length(1),
});

// One PNG only; bound the JSON body before parsing, including chunked responses.
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

/** Validate and freeze before dispatch; local errors are not ambiguous submissions. */
export function createNovelAIImageGenerator(
  token: string,
  prompt: string,
  settings: NovelAISettings,
): (signal?: AbortSignal) => Promise<{ imageUrl: string; seed: number }> {
  const apiToken = normalizeNovelAIToken(token);
  if (!apiToken || /\s/.test(apiToken)) throw new Error('请填写有效的 NovelAI Persistent API Token');
  if (!prompt.trim() || prompt.length > 20_000) throw new Error('请填写提示词，且不超过 20,000 字符');
  if (!NOVELAI_MODELS.some((model) => model === settings.model)) throw new Error('NovelAI 仅支持 V4.5 Curated 和 V5 Curated');
  const endpoint = resolveNovelAIEndpoint(settings.baseUrl);
  const options = parseNovelAISettings(settings);
  const [width, height] = options.size.split('x').map(Number);
  const seed = options.seed === '' ? crypto.getRandomValues(new Uint32Array(1))[0] : Number(options.seed);
  const input = prompt.trim();
  const negative = options.negativePrompt.trim();

  return async (signal?: AbortSignal) => {
    try {
      // Direct fetch intentionally bypasses project auth/activity headers and Hosted routing.
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          input,
          model: options.model,
          action: 'generate',
          parameters: {
            params_version: 4,
            width, height, seed,
            n_samples: 1,
            steps: options.steps,
            scale: options.scale,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            image_format: 'png',
            negative_prompt: negative,
            cfg_rescale: 0,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: false,
            v4_prompt: { caption: { base_caption: input, char_captions: [] }, use_coords: false, use_order: true },
            v4_negative_prompt: { caption: { base_caption: negative, char_captions: [] }, legacy_uc: false },
          },
        }),
      });

      if (!response.ok) {
        await response.body?.cancel();
        // Never display provider bodies: they may echo credentials or request content.
        const errors: Record<number, string> = {
          400: 'NovelAI 拒绝了生成参数，请检查模型与提示词',
          401: 'NovelAI Token 无效或已过期，请重新获取 Persistent API Token',
          402: 'NovelAI Anlas 余额不足或订阅不可用，请检查账号',
          403: 'NovelAI 拒绝访问，请检查 Token 与账号权限',
          429: 'NovelAI 请求过于频繁或已有生成任务，请稍后手动重试',
        };
        throw new Error(errors[response.status] ?? `NovelAI 请求失败（HTTP ${response.status}），请稍后检查账号与生成记录`);
      }
      if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
        await response.body?.cancel();
        throw new Error('NovelAI 未返回预期的图片 JSON，请勿立即重复生成');
      }
      const reader = response.body.getReader();
      let text = '';
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('NovelAI 图片响应超过 24 MiB，请使用较小尺寸');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new Error('NovelAI 返回了无效的图片 JSON'); }
      const result = responseSchema.safeParse(data);
      if (!result.success) throw new Error('NovelAI 未返回有效图片');
      const image = result.data.images[0];
      if (!image.image.startsWith('iVBORw0KGgo') || image.image.length % 4 !== 0) {
        throw new Error('NovelAI 返回的图片不是预期的 PNG 格式');
      }
      return { imageUrl: `data:image/png;base64,${image.image}`, seed: image.seed ?? seed };
    } catch (error) {
      if (signal?.aborted) throw new Error('已取消等待 NovelAI；已提交的任务可能仍会生成并计费');
      if (error instanceof TypeError) throw new Error('无法连接 NovelAI，请检查网络或跨域限制；请求可能已提交，请勿立即重复生成');
      throw error;
    }
  };
}

export async function generateNovelAIImage(
  token: string, prompt: string, settings: NovelAISettings, signal?: AbortSignal,
): Promise<{ imageUrl: string; seed: number }> {
  return createNovelAIImageGenerator(token, prompt, settings)(signal);
}
