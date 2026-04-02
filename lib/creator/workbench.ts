export type CreatorGenerationMode = 'non-stream' | 'stream';

type StreamedGeneralCardLike = {
  content?: string | null;
} | null | undefined;

type CreatorWorkbenchResultInput = {
  generationMode: CreatorGenerationMode;
  magicalGirlDetails: unknown | null;
  streamingMarkdown: string | null | undefined;
  streamedGeneralCard: StreamedGeneralCardLike;
};

type MediaQueryChangeHandler = (event: MediaQueryListEvent) => void;

type CompatibleMediaQueryList = Pick<
  MediaQueryList,
  'addEventListener' | 'removeEventListener' | 'addListener' | 'removeListener'
>;

export const normalizeCreatorStreamingMarkdown = (streamingMarkdown: string | null | undefined): string | null => {
  if (typeof streamingMarkdown !== 'string') {
    return null;
  }
  return streamingMarkdown.trim().length > 0 ? streamingMarkdown : null;
};

export const hasStreamingCreatorResult = ({
  streamingMarkdown,
  streamedGeneralCard,
}: Pick<CreatorWorkbenchResultInput, 'streamingMarkdown' | 'streamedGeneralCard'>): boolean => {
  if (streamedGeneralCard != null) {
    return true;
  }
  return normalizeCreatorStreamingMarkdown(streamingMarkdown) !== null;
};

export const hasCreatorWorkbenchResult = ({
  generationMode,
  magicalGirlDetails,
  streamingMarkdown,
  streamedGeneralCard,
}: CreatorWorkbenchResultInput): boolean => {
  if (generationMode === 'stream') {
    return hasStreamingCreatorResult({ streamingMarkdown, streamedGeneralCard });
  }
  return magicalGirlDetails !== null;
};

export const subscribeToMediaQueryChange = (
  mediaQuery: CompatibleMediaQueryList,
  listener: MediaQueryChangeHandler
): (() => void) => {
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener);
    return () => {
      mediaQuery.removeEventListener?.('change', listener);
    };
  }

  mediaQuery.addListener?.(listener);
  return () => {
    mediaQuery.removeListener?.(listener);
  };
};
