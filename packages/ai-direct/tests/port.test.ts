import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

import type { AiExecutionPort } from '@mahoshojo/ai-direct';

class InMemoryAiExecutionPort implements AiExecutionPort {
  async execute(request: AiExecutionRequest, signal: AbortSignal): Promise<AiExecutionResult> {
    if (signal.aborted) {
      return {
        status: 'cancelled',
        requestId: request.requestId,
        contractVersion: request.contractVersion,
        mode: request.mode,
        reason: 'aborted',
      };
    }
    return {
      status: 'completed',
      requestId: request.requestId,
      contractVersion: request.contractVersion,
      mode: request.mode,
      output: { text: 'done' },
      finishReason: 'stop',
    };
  }

  async *stream(request: AiExecutionRequest, signal: AbortSignal): AsyncIterable<AiStreamEvent> {
    yield {
      type: 'started',
      requestId: request.requestId,
      contractVersion: request.contractVersion,
      mode: request.mode,
      sequence: 0,
    };
    yield {
      type: 'result',
      requestId: request.requestId,
      contractVersion: request.contractVersion,
      mode: request.mode,
      sequence: 1,
      result: signal.aborted
        ? {
            status: 'cancelled',
            requestId: request.requestId,
            contractVersion: request.contractVersion,
            mode: request.mode,
            reason: 'aborted',
          }
        : await this.execute(request, signal),
    };
  }
}

describe('AiExecutionPort', () => {
  it('is implementable without a runtime or provider dependency', async () => {
    const request: AiExecutionRequest = {
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'direct-local',
      messages: [{ role: 'user', content: 'hello' }],
    };
    const port: AiExecutionPort = new InMemoryAiExecutionPort();

    await expect(port.execute(request, new AbortController().signal)).resolves.toMatchObject({ status: 'completed' });

    const controller = new AbortController();
    controller.abort();
    await expect(port.execute(request, controller.signal)).resolves.toMatchObject({ status: 'cancelled' });
    const events: AiStreamEvent[] = [];
    for await (const event of port.stream(request, controller.signal)) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { status: 'cancelled' } });
  });
});
