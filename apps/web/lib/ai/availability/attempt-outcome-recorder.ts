import {
  createAttemptOutcomeRecorder as createRuntimeAttemptOutcomeRecorder,
} from '@mahoshojo/hosted-runtime/node-runtime/availability';

import { recordAiChannelOutcome } from './record-outcome';

export const createAttemptOutcomeRecorder = (
  channelContext?: Parameters<typeof createRuntimeAttemptOutcomeRecorder>[0],
) => createRuntimeAttemptOutcomeRecorder(channelContext, recordAiChannelOutcome);

export {
  pipeStreamWithAttemptOutcome,
  wrapResponseWithAttemptOutcome,
  type AttemptChannelContext,
  type AttemptOutcomeRecorder,
  type PipeStreamOutcomeOptions,
} from '@mahoshojo/hosted-runtime/node-runtime/availability';
