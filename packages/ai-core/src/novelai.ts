import { z } from 'zod';

export const NOVELAI_MODELS = [
  'nai-diffusion-4-5-curated',
  'nai-diffusion-5-curated',
] as const;

export const NOVELAI_SIZES = ['832x1216', '1216x832', '1024x1024'] as const;

export const DEFAULT_NOVELAI_SETTINGS = {
  baseUrl: '',
  model: NOVELAI_MODELS[0] as string,
  size: NOVELAI_SIZES[0] as string,
  steps: 28,
  scale: 7,
  seed: '',
  negativePrompt: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
};

export type NovelAISettings = typeof DEFAULT_NOVELAI_SETTINGS;
const settingsSchema = z.object({
  model: z.enum(NOVELAI_MODELS),
  size: z.enum(NOVELAI_SIZES),
  steps: z.number().int().min(1).max(50),
  scale: z.number().min(0).max(10),
  seed: z.string().trim().refine((value) => value === '' || (/^\d+$/.test(value) && Number(value) <= 0xffffffff)),
  negativePrompt: z.string().max(20_000),
});

/** 只校验非秘密参数；端点、凭据、随机种子和派发仍由宿主持有。 */
export function parseNovelAISettings(settings: NovelAISettings) {
  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) throw new Error('请检查 NovelAI 参数：步数 1–50，强度 0–10，种子留空或填写 0–4294967295 的整数');
  return parsed.data;
}

export {
  NOVELAI_PROMPT_PROFILES, getNovelAIPromptProfile, buildNovelAIPromptRewriteInstruction,
  type NovelAIPromptRewriteOptions,
} from './novelai-prompt';
