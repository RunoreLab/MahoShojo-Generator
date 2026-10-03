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
import { BUILTIN_ARENA_NEWS_PACKAGE_REF, createWebPackageOverlay } from '@mahoshojo/web-package';

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

describe('Markdown completion follows the authoritative terminal', () => {
  it('accepts completed text without inventing a Markdown heading requirement', async () => {
    const initial = useBattleStore.getState();
    await act(async () => useBattleStore.setState({ reportFormat: 'markdown',
      settings: { ...initial.settings, writeArenaHistory: false, writeCurrentState: false } }));
    const body = '完整的普通叙事正文，没有二级标题。'.repeat(15);
    mocks.openStream.mockResolvedValue(new Response(
      sse('markdown', { chunk: body }) + sse('done', { status: 'completed', ok: true }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    await act(async () => current.handleGenerate());
    expect(useBattleStore.getState().streamingMarkdown).toBe(body);
    expect(useBattleStore.getState().error).toBeFalsy();
  });

  it.each(['failed', 'missing'])('does not update cards or repeat generation with a %s done event', async (terminal) => {
    await act(async () => useBattleStore.setState({ reportFormat: 'markdown' }));
    const body = '# 开场\n\n## 已有小标题\n' + '未完成正文'.repeat(40);
    mocks.openStream.mockResolvedValue(new Response(
      sse('markdown', { chunk: body }) + (terminal === 'failed' ? sse('done', { status: 'failed', ok: false }) : ''),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    await act(async () => current.handleGenerate());
    expect(useBattleStore.getState().streamingMarkdown).toBe(body);
    expect(useBattleStore.getState().error).toContain(terminal === 'failed' ? '未成功完成' : '未收到 done');
    expect(mocks.updateFromMarkdown).not.toHaveBeenCalled();
    if (terminal === 'failed') expect(mocks.cooldown).not.toHaveBeenCalled();
    // Unknown connection state may still have a live producer; preserve the existing throttle.
    else expect(mocks.cooldown).toHaveBeenCalledTimes(1);
    expect(mocks.openStream).toHaveBeenCalledTimes(1);
  });
});

describe('single-player Web generation integration', () => {
  it('freezes a package ref and preserves exact overlay bytes across stream completion', async () => {
    const content = ' \n' + '<!doctype html><html><head><title>故事</title></head><body>SHIELD 原始故事</body></html>' + '\n ';
    const { generatedContent: _content, ...artifact } = await createWebPackageOverlay(BUILTIN_ARENA_NEWS_PACKAGE_REF, content);
    expect(_content).toBe(content);
    await act(async () => useBattleStore.getState().setWebPackageRef(BUILTIN_ARENA_NEWS_PACKAGE_REF));
    mocks.openStream.mockResolvedValue(new Response(
      sse('markdown', { chunk: content }) + sse('done', { status: 'completed', ok: true, webPackage: artifact }),
      { headers: { ...streamHeaders, 'x-mahoshojo-stream-meta': encodeURIComponent(JSON.stringify({ outputContract: 'web-package-target', reportFormat: 'web', webPackageRef: BUILTIN_ARENA_NEWS_PACKAGE_REF })) } },
    ));
    await act(async () => current.handleGenerate());
    expect(mocks.openStream.mock.calls[0][0].body.webPackageRef).toEqual(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    expect(useBattleStore.getState()).toMatchObject({ streamingMarkdown: content, resultWebPackage: artifact, resultWebReady: true });
  });

  it('keeps package content inert when a completed stream omits its artifact', async () => {
    await act(async () => useBattleStore.getState().setWebPackageRef(BUILTIN_ARENA_NEWS_PACKAGE_REF));
    mocks.openStream.mockResolvedValue(new Response(sse('markdown', { chunk: source }) + sse('done', { status: 'completed', ok: true }), {
      headers: { ...streamHeaders, 'x-mahoshojo-stream-meta': encodeURIComponent(JSON.stringify({ outputContract: 'web-package-target', reportFormat: 'web', webPackageRef: BUILTIN_ARENA_NEWS_PACKAGE_REF })) },
    }));
    await act(async () => current.handleGenerate());
    expect(useBattleStore.getState().resultWebReady).toBe(false);
  });

  it('uses a recovered generation contract instead of the current package selection', async () => {
    await act(async () => useBattleStore.getState().setWebPackageRef(BUILTIN_ARENA_NEWS_PACKAGE_REF));
    mocks.openStream.mockResolvedValue(new Response(
      sse('snapshot', { markdown: source, status: 'completed' }) + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));
    await act(async () => current.handleGenerate());
    expect(useBattleStore.getState()).toMatchObject({ streamingMarkdown: source, resultWebReady: true, resultWebPackage: null });
  });

  it('restores a persisted package snapshot without stream metadata headers and preserves original bytes', async () => {
    const { generatedContent: content, ...artifact } = await createWebPackageOverlay(BUILTIN_ARENA_NEWS_PACKAGE_REF, ' \n' + '<!doctype html><html><head><title>历史故事</title></head><body>SHIELD 原始数据</body></html>' + '\n ');
    await act(async () => useBattleStore.getState().setReportFormat('markdown'));
    mocks.openStream.mockResolvedValue(new Response(
      sse('snapshot', { markdown: content, status: 'completed' }) + sse('done', { status: 'completed', ok: true, webPackage: artifact }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    await act(async () => current.handleGenerate());
    expect(useBattleStore.getState()).toMatchObject({ streamingMarkdown: content, resultReportFormat: 'web', resultWebReady: true, resultWebPackage: artifact });
  });

  it('preserves a non-stream package descriptor and clears selection when returning to Markdown', async () => {
    const content = '<!doctype html><html><head><title>故事</title></head><body>SHIELD 原始故事</body></html>';
    const { generatedContent: _content, ...webPackage } = await createWebPackageOverlay(BUILTIN_ARENA_NEWS_PACKAGE_REF, content);
    expect(_content).toBe(content);
    await act(async () => {
      useBattleStore.getState().setGenerationMode('non-stream');
      useBattleStore.getState().setWebPackageRef(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    });
    const report = { reportFormat: 'web', webPackage, headline: '故事', article: { body: content, analysis: '' }, officialReport: { winner: '角色甲', conclusion: '' }, reporterInfo: { name: '记者', publication: 'Arena' } };
    mocks.dispatch.mockResolvedValue(Response.json({ report, updatedCombatants: [], generationId: 'generation-package' }));
    await act(async () => current.handleGenerate());
    expect(JSON.parse(mocks.dispatch.mock.calls[0][1].body).webPackageRef).toEqual(BUILTIN_ARENA_NEWS_PACKAGE_REF);
    expect(useBattleStore.getState()).toMatchObject({ newsReport: report, resultWebPackage: webPackage, resultWebReady: true });
    await act(async () => useBattleStore.getState().setReportFormat('markdown'));
    expect(useBattleStore.getState().webPackageRef).toBeNull();
    expect(useBattleStore.getState().resultWebPackage).toEqual(webPackage);
  });

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

/**
 * telemetry 恢复：原先这组性质是用 grep `useBattleEngine.ts` 的源码守住���
 * （`tests/arena-snapshot-telemetry-restore.test.ts`，按 `indexOf("if (event === 'snapshot')")`
 * 切分支再断言里面出现过 `applyTelemetryPayload`）。那种写法只要有人调整 SSE 分支的顺序、
 * 或把调用挪进一个 helper，就会红，而行为一点没变。
 *
 * 换成真的驱动一次流之后，守的是同一组性质但从「源码长什么样」变成「状态变成什么」：
 * snapshot bootstrap 必须把 telemetry 恢复到 store；`telemetry` 事件与它共用同一份
 * 公开契约字段；旧 replay 存量仍可能只发内部字段 `model`，必须继续被接受。
 *
 * 前提是这三个字段在生成开始时被重置为 `null`（`useBattleEngine` 的 reset 段），
 * 且本文件的 `streamHeaders` **不带** `ai.model`——所以下面的断言是真实的
 * null → 值 转变，而不是「本来就是这个值」。
 */
describe('telemetry restore across snapshot bootstrap and telemetry events', () => {
  const telemetryFields = () => {
    const { streamAiModel, streamAiUsage, streamNarrativeHistoryReadCount } = useBattleStore.getState();
    return { streamAiModel, streamAiUsage, streamNarrativeHistoryReadCount };
  };

  it('starts from null so the assertions below are real transitions', () => {
    expect(telemetryFields()).toEqual({
      streamAiModel: null,
      streamAiUsage: null,
      streamNarrativeHistoryReadCount: null,
    });
  });

  it('restores model, usage and narrative count from the snapshot telemetry payload', async () => {
    mocks.openStream.mockResolvedValue(new Response(
      sse('snapshot', {
        markdown: '# 恢复的战报',
        status: 'completed',
        telemetry: {
          usage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
          narrativeHistoryReadCount: 4,
          aiModel: 'arena-model-x',
        },
      }) + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));

    await act(async () => current.handleGenerate());

    expect(telemetryFields()).toEqual({
      streamAiModel: 'arena-model-x',
      streamAiUsage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
      streamNarrativeHistoryReadCount: 4,
    });
  });

  it('does not fabricate telemetry when the snapshot carries none', async () => {
    mocks.openStream.mockResolvedValue(new Response(
      sse('snapshot', { markdown: '# 无 telemetry 的战报', status: 'completed' })
      + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));

    await act(async () => current.handleGenerate());

    expect(useBattleStore.getState().streamingMarkdown).toBe('# 无 telemetry 的战报');
    expect(telemetryFields()).toEqual({
      streamAiModel: null,
      streamAiUsage: null,
      streamNarrativeHistoryReadCount: null,
    });
  });

  it('applies the same public contract from a standalone telemetry event', async () => {
    mocks.openStream.mockResolvedValue(new Response(
      sse('telemetry', {
        usage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 },
        narrativeHistoryReadCount: 9,
        aiModel: 'arena-model-y',
      }) + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));

    await act(async () => current.handleGenerate());

    expect(telemetryFields()).toEqual({
      streamAiModel: 'arena-model-y',
      streamAiUsage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 },
      streamNarrativeHistoryReadCount: 9,
    });
  });

  it('keeps accepting the legacy replay field model, and prefers aiModel when both arrive', async () => {
    mocks.openStream.mockResolvedValue(new Response(
      sse('telemetry', { model: 'legacy-model', narrativeHistoryReadCount: 1 })
      + sse('telemetry', { aiModel: 'new-model', model: 'legacy-model' })
      + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));

    await act(async () => current.handleGenerate());

    expect(useBattleStore.getState().streamAiModel).toBe('new-model');
  });

  it('sanitizes the restored model name through the shield-word filter', async () => {
    mocks.openStream.mockResolvedValue(new Response(
      sse('snapshot', {
        markdown: '# 战报',
        status: 'completed',
        telemetry: { aiModel: 'SHIELD-model' },
      }) + sse('done', { status: 'completed', ok: true }),
      { headers: streamHeaders },
    ));

    await act(async () => current.handleGenerate());

    expect(useBattleStore.getState().streamAiModel).toBe('被替换-model');
    expect(mocks.shield).toHaveBeenCalledWith('SHIELD-model');
  });
});
