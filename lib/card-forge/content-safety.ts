import type { GameCardFaceData } from '@/lib/schemas/game-card';
import { applyShieldWords } from '@/lib/shield-word-filter';

export type GameCardFaceDataShieldResult = {
  faceData: GameCardFaceData;
  hasShieldWords: boolean;
  detectedWords: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const applyShieldWordsToValue = (
  value: unknown,
  detectedWords: Set<string>,
): unknown => {
  if (typeof value === 'string') {
    const result = applyShieldWords(value);
    for (const word of result.detectedWords) detectedWords.add(word);
    return result.filteredText;
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyShieldWordsToValue(item, detectedWords));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        applyShieldWordsToValue(item, detectedWords),
      ]),
    );
  }

  return value;
};

export const applyShieldWordsToGameCardFaceData = (
  faceData: GameCardFaceData,
): GameCardFaceDataShieldResult => {
  const detectedWords = new Set<string>();
  const maskedFaceData = applyShieldWordsToValue(faceData, detectedWords) as GameCardFaceData;

  return {
    faceData: maskedFaceData,
    hasShieldWords: detectedWords.size > 0,
    detectedWords: [...detectedWords],
  };
};
