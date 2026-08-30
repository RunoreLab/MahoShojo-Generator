import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';

import type { AiExecutionPort, SecureVault } from '@mahoshojo/ai-direct';

class InMemorySecureVault implements SecureVault {
  readonly #secrets = new Map<string, string>();

  async setSecret(ref: string, value: string): Promise<void> {
    this.#secrets.set(ref, value);
  }

  async getSecret(ref: string): Promise<string | null> {
    return this.#secrets.get(ref) ?? null;
  }

  async deleteSecret(ref: string): Promise<void> {
    this.#secrets.delete(ref);
  }
}

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

describe('SecureVault', () => {
  it('is a runtime-neutral secret reference port', async () => {
    const vault: SecureVault = new InMemorySecureVault();

    await vault.setSecret('vault:profile-1:api-key', 'secret-value');
    await expect(vault.getSecret('vault:profile-1:api-key')).resolves.toBe('secret-value');

    await vault.deleteSecret('vault:profile-1:api-key');
    await expect(vault.getSecret('vault:profile-1:api-key')).resolves.toBeNull();
  });
});
