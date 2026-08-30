import type { AiChannelContext, RecordAiChannelOutcome } from './types';
import type { OutcomeClassification } from './outcome-classification';

export const recordAiChannelOutcomeSafely = (
  recordAiChannelOutcome: RecordAiChannelOutcome,
  input: AiChannelContext & OutcomeClassification,
): void => {
  try {
    const pending = recordAiChannelOutcome(input);
    if (pending) {
      void pending.catch(() => undefined);
    }
  } catch {
    // 可用性记分是旁路；同步 recorder 故障不得改变生成结果或触发上游重放。
  }
};
