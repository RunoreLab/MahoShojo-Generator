import type { D1LikeStatementResult } from '@mahoshojo/hosted-runtime/d1-http-client';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { describe, expect, it, vi } from 'vitest';
import { probeD1Readiness } from '#/d1/runtime';

const createClient = (result: D1LikeStatementResult): {
  client: NodeDataD1Client;
  prepare: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
} => {
  const all = vi.fn(async () => result);
  const statement: NodeDataD1Statement = {
    bind: vi.fn(() => statement),
    run: vi.fn(async () => result),
    all,
  };
  const prepare = vi.fn(() => statement);
  return { client: { prepare }, prepare, all };
};

describe('apps/api D1 readiness', () => {
  it('只执行可安全重放的只读探针并验证结果 envelope', async () => {
    const { client, prepare, all } = createClient({
      success: true,
      results: [{ ok: 1 }],
      meta: {},
    });

    await expect(probeD1Readiness(client)).resolves.toBe(true);
    expect(prepare).toHaveBeenCalledWith('SELECT 1 AS ok');
    expect(all).toHaveBeenCalledWith({ retry: 'safe-read' });
  });

  it('未配置、异常或非预期 envelope 均 fail closed', async () => {
    await expect(probeD1Readiness(null)).resolves.toBe(false);

    const malformed = createClient({ success: true, results: [{ ok: 0 }], meta: {} });
    await expect(probeD1Readiness(malformed.client)).resolves.toBe(false);

    const failed = createClient({ success: false, results: [], meta: {} });
    await expect(probeD1Readiness(failed.client)).resolves.toBe(false);

    const broken: NodeDataD1Client = {
      prepare: () => {
        throw new Error('transport unavailable');
      },
    };
    await expect(probeD1Readiness(broken)).resolves.toBe(false);
  });
});
