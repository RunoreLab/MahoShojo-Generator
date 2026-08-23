import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';

/**
 * Runtime-neutral boundary for an AI execution implementation.
 * Provider credentials, endpoints, and transport details stay behind this port.
 */
export interface AiExecutionPort {
  execute(_request: AiExecutionRequest): Promise<AiExecutionResult>;
  stream(_request: AiExecutionRequest, _signal: AbortSignal): AsyncIterable<AiStreamEvent>;
}
