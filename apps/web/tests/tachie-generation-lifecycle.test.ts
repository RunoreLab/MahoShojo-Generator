import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTachieWithProgress } from '@/lib/tachie/manager';
import { DEFAULT_NOVELAI_SETTINGS } from '@/lib/tachie/novelai';
import { appRouteHandler as generateHandler } from '@/app/api/tachie/generate/handler';
import { appRouteHandler as statusHandler } from '@/app/api/tachie/status/handler';

vi.mock('@/lib/content-safety/server', () => ({ enforceTextSafety: vi.fn(async () => null) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Web image adapter and shared lifecycle', () => {
  it('NovelAI 本地参数校验失败不伪报提交未知，也不发送请求', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await generateTachieWithProgress({ source: 'novelai', novelaiToken: 'token', prompt: 'p',
      novelaiSettings: { ...DEFAULT_NOVELAI_SETTINGS, steps: 0 } });
    expect(result).toMatchObject({ success: false, outcome: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('使用真实 Next handler 完成 ModelScope create/status，保持 POST 与嵌套任务 ID 合同', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === '/api/tachie/generate') return generateHandler(new Request(`https://example.test${url}`, init));
      if (url === '/api/tachie/status') return statusHandler(new Request(`https://example.test${url}`, init));
      if (url.endsWith('/images/generations')) return Response.json({ task_id: 'job-1' });
      if (url.endsWith('/tasks/job-1')) return Response.json({ task_status: 'SUCCEED', output_images: ['https://example.test/image.png'] });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateTachieWithProgress({ source: 'modelscope', modelscopeToken: 'Bearer user-token', prompt: '角色外观' });
    expect(result).toMatchObject({ success: true, outcome: 'completed', generateUuid: 'job-1', imageUrl: 'https://example.test/image.png' });
    const clientCalls = fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/'));
    expect(clientCalls).toHaveLength(2);
    expect(clientCalls.map(([, init]) => init?.method)).toEqual(['POST', 'POST']);
    expect(JSON.parse(clientCalls[1][1]!.body as string)).toEqual({ source: 'modelscope', modelscopeToken: 'user-token', generateUuid: 'job-1' });
    const upstreamCreate = fetchMock.mock.calls.find(([url]) => url.endsWith('/images/generations'))!;
    expect(JSON.parse(upstreamCreate[1]!.body as string)).toEqual({
      model: 'Stonego/XiabanmostyleV3', prompt: '角色外观', size: '1328x1328',
    });
  });

  it.each([
    ...['928x1664', '1664x928', '1328x1328', '1104x1472', '1472x1104']
      .flatMap(size => [[size, size], [` \t${size}\n `, size]]),
    ...[undefined, null, 1328, true, {}, ['928x1664'], '', '1024x1024', '928X1664', '928×1664']
      .map(size => [size, '1328x1328']),
  ])('真实 handler 保留尺寸的 HTTP trim 与 fallback：%j', async (modelscopeSize, expectedSize) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ task_id: 'size-job' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await generateHandler(new Request('https://example.test/api/tachie/generate', {
      method: 'POST', body: JSON.stringify({ source: 'modelscope', prompt: '角色外观', modelscopeToken: 'token', modelscopeSize }),
    }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'Stonego/XiabanmostyleV3', prompt: '角色外观', size: expectedSize,
    });
  });

  it.each([
    [undefined, 'Stonego/XiabanmostyleV3'], [null, 'Stonego/XiabanmostyleV3'],
    [42, 'Stonego/XiabanmostyleV3'], [[], 'Stonego/XiabanmostyleV3'],
    ['', 'Stonego/XiabanmostyleV3'], [' \t\n ', 'Stonego/XiabanmostyleV3'],
    [' \tcustom/model\n ', 'custom/model'],
  ])('真实 handler 保留模型的 HTTP trim 与默认值：%j', async (modelscopeModel, expectedModel) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ task_id: 'model-job' }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await generateHandler(new Request('https://example.test/api/tachie/generate', {
      method: 'POST', body: JSON.stringify({ source: 'modelscope', prompt: '角色外观', modelscopeToken: 'token', modelscopeModel }),
    }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: expectedModel, prompt: '角色外观', size: '1328x1328',
    });
  });

  it('LibLib 保留工作流参数、seed=0，查询异常保留 ID，恢复只查询', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { generateUuid: 'lib-job' } }))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(Response.json({ data: { generateStatus: 5, images: [{ imageUrl: 'https://example.test/lib.png', seed: 0, auditStatus: 1 }] } }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { source: 'liblib' as const, accessKey: 'access', secretKey: 'secret', prompt: 'scene', mode: 'illustration' as const, workflowUuid: 'workflow', promptNodeId: 105 };
    const unresolved = await generateTachieWithProgress(request);
    expect(unresolved).toMatchObject({ success: false, outcome: 'unresolved', generateUuid: 'lib-job' });
    const result = await generateTachieWithProgress({ ...request, resumeTaskId: unresolved.generateUuid });
    expect(result).toMatchObject({ success: true, generateUuid: 'lib-job', seed: 0, auditStatus: 1 });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/tachie/generate', '/api/tachie/status', '/api/tachie/status']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ mode: 'illustration', workflowUuid: 'workflow', promptNodeId: 105 });
  });

  it('停止 ModelScope 轮询立即结束等待，保留原任务并向 HTTP 传递 signal', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { generateUuid: 'poll-job' } }))
      .mockResolvedValue(Response.json({ taskStatus: 'RUNNING', outputImages: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = generateTachieWithProgress({ source: 'modelscope', modelscopeToken: 'token', prompt: 'p', signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    controller.abort();
    expect(await pending).toMatchObject({ outcome: 'stopped', generateUuid: 'poll-job', success: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBe(controller.signal);
  });

  it('创建响应丢失不自动创建第二次任务', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection lost'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await generateTachieWithProgress({ source: 'modelscope', modelscopeToken: 'token', prompt: 'p' }))
      .toMatchObject({ success: false, outcome: 'unresolved' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('预先取消不发 HTTP，供应商明确失败才返回 failed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ taskStatus: 'FAILED', outputImages: [], errorMessage: 'provider rejected' }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { source: 'modelscope' as const, modelscopeToken: 'token', prompt: 'p' };
    const controller = new AbortController(); controller.abort();
    expect(await generateTachieWithProgress({ ...request, signal: controller.signal })).toMatchObject({ outcome: 'stopped' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await generateTachieWithProgress({ ...request, resumeTaskId: 'failed-job' })).toMatchObject({ outcome: 'failed', generateUuid: 'failed-job' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
