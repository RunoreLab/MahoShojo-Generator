import { describe, expect, it, vi } from 'vitest';

import {
  assertCompletedPvpGenerationSseDone,
  readDurablePvpGenerationId,
  readDurablePvpTerminalGenerationId,
} from '@/lib/pvp/generation-authority';
import {
  claimPvpResolutionOwnership,
  handlePvpGenerationFailure,
} from '@/lib/pvp/generation-lifecycle';

describe('PVP generation response identity', () => {
  it('prefers the durable generation header and keeps JSON body compatibility', () => {
    const response = Response.json({ generationId: 'body-generation-1' }, {
      headers: { 'X-Mahoshojo-Generation-Id': 'header-generation-1' },
    });

    expect(readDurablePvpGenerationId(response, { generationId: 'body-generation-1' }))
      .toBe('header-generation-1');
    expect(readDurablePvpGenerationId(Response.json({}), {
      generationId: 'body-generation-1',
    })).toBe('body-generation-1');
  });

  it('returns null when the recorder did not expose a durable identity', () => {
    expect(readDurablePvpGenerationId(Response.json({ error: 'rejected' }), {
      error: 'rejected',
    })).toBeNull();
    expect(readDurablePvpGenerationId(new Response('rejected', {
      headers: { 'X-Mahoshojo-Generation-Id': 'short' },
    }), null)).toBeNull();
  });

  it('requires an explicit failed-terminal marker on non-success responses', () => {
    expect(readDurablePvpGenerationId(new Response('upstream failed', {
      status: 502,
      headers: { 'X-Mahoshojo-Generation-Id': 'reserved-generation-1' },
    }), null)).toBeNull();

    const durableRejection = Response.json({
      error: 'rejected',
      generationId: 'durable-generation-1',
    }, {
      status: 400,
      headers: { 'X-Mahoshojo-Generation-Terminal-Status': 'failed' },
    });
    expect(readDurablePvpGenerationId(durableRejection, {
      generationId: 'durable-generation-1',
    })).toBe('durable-generation-1');

    expect(readDurablePvpTerminalGenerationId(new Response('event: error', {
      status: 200,
      headers: {
        'X-Mahoshojo-Generation-Id': 'durable-fallback-1',
        'X-Mahoshojo-Generation-Terminal-Status': 'failed',
      },
    }), null)).toBe('durable-fallback-1');

    expect(readDurablePvpTerminalGenerationId(new Response('event: done', {
      status: 200,
      headers: {
        'X-Mahoshojo-Generation-Id': 'durable-completed-1',
        'X-Mahoshojo-Generation-Terminal-Status': 'completed',
      },
    }), null)).toBe('durable-completed-1');
  });

  it('accepts only a completed successful SSE done terminal', () => {
    expect(() => assertCompletedPvpGenerationSseDone({
      ok: true,
      status: 'completed',
    })).not.toThrow();
    expect(() => assertCompletedPvpGenerationSseDone({
      ok: false,
      status: 'cancelled',
    })).toThrow('上游流式生成未成功完成：cancelled');
    expect(() => assertCompletedPvpGenerationSseDone({
      ok: false,
      status: 'producer_lost',
      error: '生成生产者已丢失',
    })).toThrow('生成生产者已丢失');
  });

  it('preserves sensitive/ordinary control data and persists only marked durable failures', async () => {
    const persistGenerationId = vi.fn(async () => undefined);
    const sensitive = await handlePvpGenerationFailure({
      response: Response.json({}, {
        status: 400,
        headers: {
          'X-Mahoshojo-Generation-Id': 'durable-generation-1',
          'X-Mahoshojo-Generation-Terminal-Status': 'failed',
        },
      }),
      raw: JSON.stringify({
        error: 'sensitive',
        shouldRedirect: true,
        reason: '使用危险符文',
      }),
      persistGenerationId,
    });
    expect(sensitive).toEqual({
      generationId: 'durable-generation-1',
      errorMessage: 'sensitive',
      shouldRedirect: true,
      redirectReason: '使用危险符文',
    });
    expect(persistGenerationId).toHaveBeenCalledWith('durable-generation-1');

    persistGenerationId.mockClear();
    const ordinary = await handlePvpGenerationFailure({
      response: Response.json({}, {
        status: 502,
        headers: { 'X-Mahoshojo-Generation-Id': 'reserved-generation-1' },
      }),
      raw: JSON.stringify({ error: 'temporary failure' }),
      persistGenerationId,
    });
    expect(ordinary).toEqual({
      generationId: null,
      errorMessage: 'temporary failure',
      shouldRedirect: false,
      redirectReason: null,
    });
    expect(persistGenerationId).not.toHaveBeenCalled();
  });

  it('allows only one concurrent resolver to claim the room transition', async () => {
    let claimed = false;
    const claim = () => claimPvpResolutionOwnership({
      tryClaim: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      readPhase: async () => 'resolving',
    });

    const outcomes = await Promise.all([claim(), claim()]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['claimed', 'resolving']);
  });
});
