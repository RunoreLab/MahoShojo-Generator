import type { CreatorTemplateId } from '@/lib/creator/templates';

export type CreatorGenerationMode = 'non-stream' | 'stream';

export type CreatorWorkbenchSnapshot = {
  generationMode: CreatorGenerationMode;
  template: CreatorTemplateId;
  templateLabel: string;
  primaryRuleLabel: string;
  questionCount: number;
  nativeAllowed: boolean;
  overLimitCount: number;
  streamFallbackLabel: string;
};

type StreamedGeneralCardLike = {
  content?: string | null;
  signature?: string | null;
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

type ResolveCreatorWorkbenchDisplayStateInput = {
  currentGenerationMode: CreatorGenerationMode;
  currentTemplate: CreatorTemplateId;
  currentTemplateLabel: string;
  currentPrimaryRuleLabel: string;
  currentQuestionCount: number;
  currentStreamFallbackLabel: string;
  snapshot: CreatorWorkbenchSnapshot | null;
};

export const resolveCreatorWorkbenchDisplayState = ({
  currentGenerationMode,
  currentTemplate,
  currentTemplateLabel,
  currentPrimaryRuleLabel,
  currentQuestionCount,
  currentStreamFallbackLabel,
  snapshot,
}: ResolveCreatorWorkbenchDisplayStateInput): CreatorWorkbenchSnapshot => {
  if (snapshot) {
    return snapshot;
  }

  return {
    generationMode: currentGenerationMode,
    template: currentTemplate,
    templateLabel: currentTemplateLabel,
    primaryRuleLabel: currentPrimaryRuleLabel,
    questionCount: currentQuestionCount,
    nativeAllowed: true,
    overLimitCount: 0,
    streamFallbackLabel: currentStreamFallbackLabel,
  };
};

const hasResultSignature = (result: unknown): boolean => {
  if (typeof result !== 'object' || result === null) {
    return false;
  }

  const signature = (result as { signature?: unknown }).signature;
  return typeof signature === 'string' && signature.trim().length > 0;
};

type BuildCreatorResultOverviewInput = {
  isSubmitting: boolean;
  snapshot: CreatorWorkbenchSnapshot | null;
  result: unknown | null;
};

export const buildCreatorResultOverview = ({
  isSubmitting,
  snapshot,
  result,
}: BuildCreatorResultOverviewInput): {
  stageLabel: string;
  progressLabel: string;
  nativeHint: string;
} => {
  const questionCount = snapshot?.questionCount ?? 0;
  const overLimitCount = snapshot?.overLimitCount ?? 0;

  if (!snapshot) {
    return {
      stageLabel: isSubmitting ? '创作进行中' : '创作完成',
      progressLabel: questionCount > 0
        ? `共 ${questionCount} 题，${isSubmitting ? '结果仍在生成中' : '已进入结果阶段'}`
        : isSubmitting
          ? '结果仍在生成中'
          : '已进入结果阶段',
      nativeHint: isSubmitting ? '正在整理本轮结果原生性' : '请以当前结果数据为准',
    };
  }

  if (!snapshot.nativeAllowed) {
    return {
      stageLabel: isSubmitting ? '创作进行中' : '创作完成',
      progressLabel: `共 ${questionCount} 题，${isSubmitting ? '结果仍在生成中' : '已进入结果阶段'}`,
      nativeHint: overLimitCount > 0
        ? `本次提交有 ${overLimitCount} 条答案超过字数上限，将生成非原生结果`
        : '当前提交问卷未获得原生许可',
    };
  }

  if (isSubmitting) {
    return {
      stageLabel: '创作进行中',
      progressLabel: `共 ${questionCount} 题，结果仍在生成中`,
      nativeHint: '当前提交满足原生条件，完成签名后将具备原生性',
    };
  }

  return {
    stageLabel: '创作完成',
    progressLabel: `共 ${questionCount} 题，已进入结果阶段`,
    nativeHint: hasResultSignature(result)
      ? '当前展示结果具备原生性'
      : '原生性签名失败，当前展示结果已降级为非原生',
  };
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
