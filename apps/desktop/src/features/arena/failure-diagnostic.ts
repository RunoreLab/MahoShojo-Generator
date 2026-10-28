import { DesktopArenaHostedErrorSchema } from '@mahoshojo/contracts/desktop-arena-hosted';
import { AiExecutionFinishReasonSchema, type AiExecutionFinishReason } from '@mahoshojo/contracts/ai-execution';

const directCodes = new Set([
  'profile-not-found', 'profile-rejected', 'missing-secret', 'unsupported-request', 'upstream-unavailable',
  'upstream-rejected', 'stream-protocol', 'cancelled', 'failed', 'invalid-request', 'unsupported-model',
  'authentication-failed', 'permission-denied', 'rate-limited', 'timeout', 'service-unavailable',
  'content-filtered', 'invalid-response', 'output-too-large', 'internal-error', 'invalid-package',
  'native-invoke-rejected', 'ipc-receipt-invalid', 'ipc-delivery-timeout', 'ipc-delivery-invalid',
  'empty-output', 'incomplete-output', 'invalid-output',
]);
const hostedCodes = new Set<string>([...DesktopArenaHostedErrorSchema.shape.code.options, 'protocol', 'transport', 'native-invoke-rejected', 'ipc-receipt-invalid', 'ipc-delivery-timeout', 'ipc-delivery-invalid']);
const stages = ['request', 'native-stream', 'output', 'create-stream', 'create-json', 'lookup-request', 'resume', 'stop', 'status', 'stream', 'native-settle', 'session'] as const;
export type ArenaFailureStage = typeof stages[number];
export interface ArenaFailureDiagnostic {
  source: 'client' | 'server';
  stage: ArenaFailureStage;
  code: string;
  dispatchState?: 'not-dispatched' | 'unknown';
  /** Optional local evidence; old saved diagnostics remain readable. */
  terminalStatus?: 'completed' | 'failed' | 'unconfirmed';
  finishReason?: AiExecutionFinishReason;
  outputChars?: number;
}

/** Only closed local classifications are shareable. Never retain exception messages or native arguments. */
export const parseArenaFailureDiagnostic = (value: unknown): ArenaFailureDiagnostic | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if ((v.source !== 'client' && v.source !== 'server') || !stages.includes(v.stage as ArenaFailureStage)) return null;
  const allowed = v.source === 'client' ? directCodes : hostedCodes;
  const finishReason = AiExecutionFinishReasonSchema.safeParse(v.finishReason);
  return { source: v.source, stage: v.stage as ArenaFailureStage,
    code: typeof v.code === 'string' && allowed.has(v.code) ? v.code : 'unclassified',
    ...(v.source === 'server' && (v.dispatchState === 'not-dispatched' || v.dispatchState === 'unknown') ? { dispatchState: v.dispatchState } : {}),
    ...(v.source === 'client' && ['completed', 'failed', 'unconfirmed'].includes(v.terminalStatus as string)
      ? { terminalStatus: v.terminalStatus as ArenaFailureDiagnostic['terminalStatus'] } : {}),
    ...(v.source === 'client' && v.terminalStatus === 'completed' && finishReason.success ? { finishReason: finishReason.data } : {}),
    ...(v.source === 'client' && typeof v.outputChars === 'number' && Number.isSafeInteger(v.outputChars) && v.outputChars >= 0
      ? { outputChars: v.outputChars } : {}),
  };
};
