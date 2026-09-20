// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaGenerationConnectionState } from '@/lib/arena/resumable-generation-client';

const mocks = vi.hoisted(() => ({
  openStream: vi.fn(), dispatch: vi.fn(), quickCheck: vi.fn(), shield: vi.fn(),
  updateFromMarkdown: vi.fn(), resolveRandom: vi.fn(), cooldown: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock('@/lib/client-route-adapter', () => ({ useClientRouteAdapter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/cooldown', () => ({ useProviderModeCooldown: () => ({ isCooldown: false, startCooldown: mocks.cooldown, remainingTime: 0, otherRemainingTime: 0 }) }));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.quickCheck }));
vi.mock('@/lib/shield-word-filter', () => ({ applyShieldWords: mocks.shield }));
vi.mock('@/lib/auth', () => ({ authStorage: { getAuthHeader: async () => null, getActivityHeaders: async () => ({}) } }));
vi.mock('@/components/arena/hooks/useBattleActions', () => ({ useBattleActions: () => ({ handleResolveRandomPlaceholders: mocks.resolveRandom }) }));
vi.mock('@/components/arena/hooks/useStreamCombatantUpdater', () => ({ useStreamCombatantUpdater: () => ({ updateFromMarkdown: mocks.updateFromMarkdown, retryGenerationUpdate: vi.fn() }) }));
vi.mock('@/components/arena/multiplayer/useArenaRoom', () => ({ useArenaRoomContext: () => null }));
vi.mock('@/lib/use-generation-api-intent-latch', () => ({ useGenerationApiIntentLatch: () => ({ tryAcquire: () => ({ dispatch: mocks.dispatch }) }) }));
vi.mock('@/lib/arena/resumable-generation-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/arena/resumable-generation-client')>(),
  openArenaGenerationStream: mocks.openStream,
}));

import { useBattleEngine } from '@/components/arena/hooks/useBattleEngine';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let current: ReturnType<typeof useBattleEngine>;
let root: Root;
let container: HTMLDivElement;
const Harness = () => { current = useBattleEngine(); return null; };
const source = '<!doctype html><html><body><svg></svg><script>const SHIELD = "原始HTML";</script></body></html>';
const sse = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'x-mahoshojo-generation-id': 'generation-web-test',
  'x-mahoshojo-stream-meta': encodeURIComponent(JSON.stringify({ outputContract: 'web-document', reportFormat: 'web' })),
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false, matchDetails: [], detectedWords: [] });
  mocks.shield.mockImplementation((text: string) => ({ filteredText: text.replaceAll('SHIELD', '被替换') }));
  mocks.resolveRandom.mockResolvedValue(undefined);
  mocks.updateFromMarkdown.mockResolvedValue(undefined);
  const initial = useBattleStore.getInitialState();
  useBattleStore.setState({ ...initial, reportFormat: 'web', generationMode: 'stream', battleMode: 'daily', combatants: [{
    type: 'general-character', filename: 'test.json', data: { name: '角色甲' }, isValid: false, isPreset: false,
  }], settings: { ...initial.settings, writeArenaHistory: true, writeCurrentState: false, writeNarrativeHistory: false } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useBattleStore.setState(useBattleStore.getInitialState());
});

describe('single-player Web generation integration', () => {
  it('keeps raw HTML inert until a successful completed done, without shield mutations', async () => {
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    mocks.openStream.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { producer = controller; } }), { headers: streamHeaders }));
    let generation!: Promise<void>;
    await act(async () => {
      generation = current.handleGenerate();
      await vi.waitFor(() => expect(mocks.openStream).toHaveBeenCalled());
      producer.enqueue(new TextEncoder().encode(sse('markdown', { chunk: source })));
      await vi.waitFor(() => expect(useBattleStore.getState().streamingMarkdown).toBe(source));
    });
    expect(useBattleStore.getState().resultWebReady).toBe(false);
    expect(useBattleStore.getState().isGenerating).toBe(true);
    // Changing the next draft must not change the current request or its result format.
    await act(async () => {
      useBattleStore.getState().setReportFormat('markdown');
      producer.enqueue(new TextEncoder().encode(sse('done', { status: 'completed', ok: true })));
      producer.close();
      await generation;
    });
    expect(mocks.openStream.mock.calls[0][0].body.reportFormat).toBe('web');
    expect(useBattleStore.getState()).toMatchObject({ streamingMarkdown: source, resultReportFormat: 'web', resultWebReady: true, isGenerating: false });
    expect(mocks.updateFromMarkdown).toHaveBeenCalledOnce();
    expect(mocks.shield.mock.calls.some(([text]) => text === source)).toBe(false);
  });

  it.each([
    ['cancelled', sse('done', { status: 'cancelled', ok: false })],
    ['cancelled even if ok is true', sse('done', { status: 'cancelled', ok: true })],
    ['failed done', sse('done', { status: 'completed', ok: false })],
    ['missing status', sse('done', { ok: true })],
    ['server error', sse('error', { error: 'Provider failed' })],
    ['incomplete stream', ''],
  ])('does not execute or reconcile partial source after %s', async (_label, terminal) => {
    const partial = '<html><script>const SHIELD = 1;';
    mocks.openStream.mockResolvedValue(new Response(sse('markdown', { chunk: partial }) + terminal, { headers: streamHeaders }));
    await act(async () => current.handleGenerate());
    expect(useBattleStore.getState()).toMatchObject({ streamingMarkdown: partial, resultWebReady: false, isGenerating: false });
    expect(mocks.updateFromMarkdown).not.toHaveBeenCalled();
  });

  it('keeps a user-aborted stream non-executable', async () => {
    mocks.openStream.mockImplementation(async ({ signal }: { signal: AbortSignal }) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse('markdown', { chunk: source })));
        signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      },
    }), { headers: streamHeaders }));
    let generation!: Promise<void>;
    await act(async () => {
      generation = current.handleGenerate();
      await vi.waitFor(() => expect(useBattleStore.getState().streamingMarkdown).toBe(source));
      current.stopGeneration();
      await generation;
    });
    expect(useBattleStore.getState().resultWebReady).toBe(false);
    expect(mocks.updateFromMarkdown).not.toHaveBeenCalled();
  });

  it('publishes recovery status separately from the error message', async () => {
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    let onStateChange!: (state: ArenaGenerationConnectionState) => void;
    mocks.openStream.mockImplementation(async (options: {
      onStateChange: (state: ArenaGenerationConnectionState) => void;
    }) => {
      onStateChange = options.onStateChange;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          producer = controller;
        },
      }), { headers: streamHeaders });
    });

    let generation!: Promise<void>;
    await act(async () => {
      generation = current.handleGenerate();
      await vi.waitFor(() => expect(mocks.openStream).toHaveBeenCalled());
    });

    await act(async () => onStateChange('resuming'));
    expect(useBattleStore.getState()).toMatchObject({
      arenaGenerationConnectionState: 'resuming',
      error: null,
    });

    await act(async () => {
      onStateChange('generating');
      expect(useBattleStore.getState().error).toBeNull();
      producer.enqueue(new TextEncoder().encode(sse('markdown', { chunk: '# 恢复后的战报' })));
      producer.enqueue(new TextEncoder().encode(sse('done', { status: 'completed', ok: true })));
      producer.close();
      await generation;
    });

    expect(useBattleStore.getState().arenaGenerationConnectionState).toBeNull();
  });

  it('checks replay snapshots before allowing completed HTML to execute', async () => {
    const replaySource = '<html><script>const value = "FORBIDDEN";</script></html>';
    mocks.quickCheck.mockImplementation(async (text: string) => ({
      hasSensitiveWords: text.includes('FORBIDDEN'),
      detectedWords: ['FORBIDDEN'],
      matchDetails: [{ startIndex: text.indexOf('FORBIDDEN') }],
    }));
    mocks.openStream.mockResolvedValue(new Response(
      sse('snapshot', { markdown: replaySource, status: 'completed' }) + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));
    await act(async () => current.handleGenerate());
    expect(mocks.quickCheck).toHaveBeenCalledWith(replaySource);
    expect(useBattleStore.getState().resultWebReady).toBe(false);
    expect(mocks.updateFromMarkdown).not.toHaveBeenCalled();
  });

  it('preserves non-stream Web fields and original executable source', async () => {
    await act(async () => useBattleStore.getState().setGenerationMode('non-stream'));
    const report = { reportFormat: 'web', webHtml: source, headline: '权威标题', article: { body: source, analysis: '' }, officialReport: { winner: '角色甲', conclusion: '' }, reporterInfo: { name: '记者', publication: 'Arena' } };
    mocks.dispatch.mockResolvedValue(new Response(JSON.stringify({ report, updatedCombatants: [], generationId: 'generation-web-test' }), { headers: { 'Content-Type': 'application/json' } }));
    await act(async () => current.handleGenerate());
    expect(JSON.parse(mocks.dispatch.mock.calls[0][1].body).reportFormat).toBe('web');
    expect(useBattleStore.getState().newsReport).toMatchObject(report);
    expect(useBattleStore.getState()).toMatchObject({ resultReportFormat: 'web', resultWebReady: true, isGenerating: false });
    expect(mocks.shield.mock.calls.some(([text]) => text === source)).toBe(false);
  });
});
