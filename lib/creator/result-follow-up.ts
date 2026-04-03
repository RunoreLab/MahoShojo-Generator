import type { CreatorTemplateId } from './templates';

export type StructuredCreatorTemplateId = Extract<CreatorTemplateId, 'magical-girl' | 'canshou'>;

export type StructuredCreatorResultFollowUp = {
  battleLinkText: string;
  downloadButtonText: string;
  downloadFileName: string;
  portraitPrompt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ensureString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const sanitizeFileSegment = (value: string): string =>
  value.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');

const buildMagicalGirlPortraitPrompt = (result: unknown): string => {
  const record = isRecord(result) ? result : {};
  const appearance = isRecord(record.appearance) ? record.appearance : {};
  const appearanceText = Object.entries(appearance)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');

  return appearanceText
    ? `${appearanceText}, Xiabanmo, 二次元, 魔法少女`
    : 'Xiabanmo, 二次元, 魔法少女';
};

const buildCanshouPortraitPrompt = (result: unknown): string => {
  const record = isRecord(result) ? result : {};
  return [record.appearance, record.materialAndSkin, record.featuresAndAppendages]
    .map(ensureString)
    .filter(Boolean)
    .join(', ');
};

export function buildStructuredCreatorPortraitPrompt(
  template: StructuredCreatorTemplateId,
  result: unknown,
): string {
  if (template === 'canshou') {
    return buildCanshouPortraitPrompt(result);
  }

  return buildMagicalGirlPortraitPrompt(result);
}

export function getStructuredCreatorResultFollowUp(
  template: StructuredCreatorTemplateId,
  result: unknown,
): StructuredCreatorResultFollowUp {
  const record = isRecord(result) ? result : {};

  if (template === 'canshou') {
    const name = ensureString(record.name) || ensureString(record.codename) || 'data';
    return {
      battleLinkText: '前往竞技场，让它大闹一场！→',
      downloadButtonText: '💾 下载残兽档案',
      downloadFileName: `残兽档案_${sanitizeFileSegment(name)}.json`,
      portraitPrompt: buildCanshouPortraitPrompt(result),
    };
  }

  const codename = ensureString(record.codename) || ensureString(record.name) || 'data';
  return {
    battleLinkText: '前往竞技场，让她大闹一场！→',
    downloadButtonText: '💾 下载设定文件',
    downloadFileName: `魔法少女_${sanitizeFileSegment(codename)}.json`,
    portraitPrompt: buildMagicalGirlPortraitPrompt(result),
  };
}
