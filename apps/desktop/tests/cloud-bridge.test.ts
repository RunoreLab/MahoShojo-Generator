import { describe, expect, it, vi } from 'vitest';

import {
  CANCEL_HOSTED_AI_COMMAND,
  CLOUD_LOGIN_AWAIT_COMMAND,
  CLOUD_LOGIN_BEGIN_COMMAND,
  CLOUD_LOGIN_CANCEL_COMMAND,
  CLOUD_ONLINE_STATUS_COMMAND,
  CLOUD_SIGN_OUT_COMMAND,
  HOSTED_AI_REQUEST_COMMAND,
  STREAM_HOSTED_AI_COMMAND,
  DesktopCloudError,
  awaitCloudLogin,
  beginCloudLogin,
  cancelCloudLogin,
  cancelHostedAi,
  hostedAiRequest,
  probeCloudOnlineStatus,
  readCloudAuthStatus,
  signOutCloud,
  streamHostedAi,
} from '../src/platform/cloud-bridge';
import type { HostedAiChannel } from '../src/platform/cloud-bridge';

const account = { userId: 7, username: 'homura', displayName: 'homura' };

describe('cloud bridge', () => {
  it('begin：透传 flowId 与授权 URL 并按契约校验', async () => {
    const invoke = vi.fn(async () => ({
      flowId: 'flow-1',
      authorizeUrl: 'https://example.test/auth/desktop?state=s',
    }));
    const result = await beginCloudLogin(invoke);
    expect(invoke).toHaveBeenCalledWith(CLOUD_LOGIN_BEGIN_COMMAND);
    expect(result.flowId).toBe('flow-1');
    expect(result.authorizeUrl).toContain('/auth/desktop');
  });

  it('await：signed-in / cancelled / failed 都是合法终态', async () => {
    const signedIn = vi.fn(async () => ({
      status: 'signed-in',
      account,
      sessionExpiresAt: '2026-10-12T00:00:00.000Z',
    }));
    await expect(awaitCloudLogin(signedIn, 'f')).resolves.toMatchObject({ status: 'signed-in' });
    expect(signedIn).toHaveBeenCalledWith(CLOUD_LOGIN_AWAIT_COMMAND, { flowId: 'f' });

    const cancelled = vi.fn(async () => ({ status: 'cancelled' }));
    await expect(awaitCloudLogin(cancelled, 'f')).resolves.toEqual({ status: 'cancelled' });

    const failed = vi.fn(async () => ({
      status: 'failed',
      code: 'state-mismatch',
      message: '回跳 state 与本次登录不匹配',
    }));
    await expect(awaitCloudLogin(failed, 'f')).resolves.toMatchObject({ status: 'failed' });
  });

  it('await：native 契约违例 → bridge-invalid，而不是放行', async () => {
    const invoke = vi.fn(async () => ({ status: 'signed-in' /* 缺 account */ }));
    await expect(awaitCloudLogin(invoke, 'f')).rejects.toMatchObject({
      name: 'DesktopCloudError',
      code: 'bridge-invalid',
      command: CLOUD_LOGIN_AWAIT_COMMAND,
    });
  });

  it('cancel：只接受布尔回值', async () => {
    await expect(cancelCloudLogin(vi.fn(async () => true), 'f')).resolves.toBe(true);
    await expect(cancelCloudLogin(vi.fn(async () => 'yes'), 'f')).rejects.toMatchObject({
      name: 'DesktopBridgeError',
    });
    const invoke = vi.fn(async () => true);
    await cancelCloudLogin(invoke, 'f-9');
    expect(invoke).toHaveBeenCalledWith(CLOUD_LOGIN_CANCEL_COMMAND, { flowId: 'f-9' });
  });

  it('status：四种状态投影都过契约；unreachable 不带账号', async () => {
    const cases = [
      { state: 'signed-out' },
      { state: 'active', account, sessionExpiresAt: '2026-10-12T00:00:00.000Z' },
      { state: 'expired' },
      { state: 'unreachable' },
    ];
    for (const projection of cases) {
      const invoke = vi.fn(async () => projection);
      await expect(readCloudAuthStatus(invoke)).resolves.toEqual(projection);
    }
    const bad = vi.fn(async () => ({ state: 'active' }));
    await expect(readCloudAuthStatus(bad)).rejects.toMatchObject({ code: 'bridge-invalid' });
  });

  it('native 错误按 code/message 原样投影', async () => {
    const invoke = vi.fn(async () => {
      throw { code: 'storage-unavailable', message: '操作系统凭据存储不可用' };
    });
    await expect(readCloudAuthStatus(invoke)).rejects.toMatchObject({
      name: 'DesktopCloudError',
      code: 'storage-unavailable',
      message: '操作系统凭据存储不可用',
    });
  });

  it('契约内的错误码（invalid-request 等）原样透出，未知 code 归一为 internal-error', async () => {
    for (const code of ['invalid-request', 'flow-in-progress', 'protocol-mismatch']) {
      const invoke = vi.fn(async () => {
        throw { code, message: `native ${code}` };
      });
      await expect(readCloudAuthStatus(invoke)).rejects.toMatchObject({
        name: 'DesktopCloudError',
        code,
      });
    }
    const unknown = vi.fn(async () => {
      throw { code: 'brand-new-code', message: 'future error' };
    });
    await expect(readCloudAuthStatus(unknown)).rejects.toMatchObject({
      name: 'DesktopCloudError',
      code: 'internal-error',
      message: 'future error',
    });
  });

  it('sign-out：本地无条件删除 + revoked 回显', async () => {
    const invoke = vi.fn(async () => ({ revoked: true }));
    await expect(signOutCloud(invoke)).resolves.toEqual({ revoked: true });
    expect(invoke).toHaveBeenCalledWith(CLOUD_SIGN_OUT_COMMAND);
  });

  it('online probe：可达性与兼容版本原样返回；不可达给 null 兼容', async () => {
    const reachable = vi.fn(async () => ({
      reachable: true,
      contractVersion: 'g25e1-v1',
      compatible: true,
    }));
    await expect(probeCloudOnlineStatus(reachable)).resolves.toMatchObject({
      reachable: true,
      compatible: true,
    });
    expect(reachable).toHaveBeenCalledWith(CLOUD_ONLINE_STATUS_COMMAND);

    const unreachable = vi.fn(async () => ({
      reachable: false,
      compatible: null,
    }));
    await expect(probeCloudOnlineStatus(unreachable)).resolves.toMatchObject({
      reachable: false,
      compatible: null,
    });
  });

  it('IPC 抛错统一归一为 DesktopCloudError', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('ipc down');
    });
    await expect(beginCloudLogin(invoke)).rejects.toBeInstanceOf(DesktopCloudError);
    await expect(beginCloudLogin(invoke)).rejects.toMatchObject({ code: 'internal-error' });
  });

  it('hosted stream：请求过契约后随 Channel 交给 native，事件按白名单过滤', async () => {
    const channel: HostedAiChannel = {};
    const invoke = vi.fn(async () => undefined);
    const seen: unknown[] = [];

    await streamHostedAi(
      invoke,
      {
        requestId: 'req-1',
        routeId: 'generate-magical-girl-details-stream',
        body: { answers: {}, language: 'zh-CN' },
      },
      (event) => seen.push(event),
      { createChannel: () => channel },
    );

    expect(invoke).toHaveBeenCalledWith(STREAM_HOSTED_AI_COMMAND, {
      request: {
        requestId: 'req-1',
        routeId: 'generate-magical-girl-details-stream',
        body: { answers: {}, language: 'zh-CN' },
      },
      onEvent: channel,
    });

    channel.onmessage?.({ event: 'markdown', data: { chunk: '一段' } });
    // 故意注入契约外事件名：验证桥层白名单过滤（类型上断言，运行时才是被测对象）。
    channel.onmessage?.({ event: 'unknown_future', data: {} } as never);
    channel.onmessage?.({ event: 'done', data: { ok: true } });
    expect(seen).toEqual([
      { event: 'markdown', data: { chunk: '一段' } },
      { event: 'error', data: { ok: false, code: 'bridge-invalid', message: 'native 推送了契约外事件' } },
      { event: 'done', data: { ok: true } },
    ]);
  });

  it('hosted stream：请求自身违例在 invoke 前就被契约拦下', async () => {
    const invoke = vi.fn(async () => undefined);
    expect(() =>
      streamHostedAi(
        invoke,
        { requestId: 'r', routeId: 'not-a-route', body: {} } as never,
        () => {},
        { createChannel: () => ({}) },
      ),
    ).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('hosted json：请求过契约后透传，「HTTP 状态 + JSON 正文」原样返回', async () => {
    const invoke = vi.fn(async () => ({
      status: 200,
      body: { data: { codename: 'homura' }, aiMeta: { aiModel: 'glm' } },
    }));
    const result = await hostedAiRequest(invoke, {
      requestId: 'req-1',
      routeId: 'generate-magical-girl-details',
      body: { answers: [], allowNativeSignature: true },
    });
    expect(invoke).toHaveBeenCalledWith(HOSTED_AI_REQUEST_COMMAND, {
      request: {
        requestId: 'req-1',
        routeId: 'generate-magical-girl-details',
        body: { answers: [], allowNativeSignature: true },
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ data: { codename: 'homura' } });

    // 非 2xx 是业务投影而非传输失败：状态与正文原样回到调用方。
    const rejected = vi.fn(async () => ({ status: 429, body: { error: 'rate limited' } }));
    await expect(hostedAiRequest(rejected, {
      requestId: 'req-2',
      routeId: 'generate-magical-girl-details',
      body: {},
    })).resolves.toMatchObject({ status: 429 });
    // 网关错误页 → body: null，status 仍携带诊断信息。
    const timeout = vi.fn(async () => ({ status: 524, body: null }));
    await expect(hostedAiRequest(timeout, {
      requestId: 'req-3',
      routeId: 'generate-magical-girl-details',
      body: {},
    })).resolves.toEqual({ status: 524, body: null });
  });

  it('hosted json：路由白名单与凭据字段在 invoke 前被契约拦下', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: {} }));
    // 流式路由不属于非流式白名单。
    await expect(hostedAiRequest(invoke, {
      requestId: 'r',
      routeId: 'generate-magical-girl-details-stream',
      body: {},
    } as never)).rejects.toThrow();
    await expect(hostedAiRequest(invoke, {
      requestId: 'r',
      routeId: 'generate-magical-girl-details',
      body: {},
      secretRef: 'provider-key:abc',
    } as never)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();

    // native 契约违例 → bridge-invalid。
    const bad = vi.fn(async () => ({ status: 200 /* 缺 body */ }));
    await expect(hostedAiRequest(bad, {
      requestId: 'r',
      routeId: 'generate-magical-girl-details',
      body: {},
    })).rejects.toMatchObject({ code: 'bridge-invalid' });
    // native 错误原样投影。
    const failed = vi.fn(async () => {
      throw { code: 'protocol-mismatch', message: '服务端契约版本不兼容' };
    });
    await expect(hostedAiRequest(failed, {
      requestId: 'r',
      routeId: 'generate-magical-girl-details',
      body: {},
    })).rejects.toMatchObject({ code: 'protocol-mismatch' });
  });

  it('hosted cancel：只接受布尔回值并按 requestId 透传', async () => {
    const invoke = vi.fn(async () => true);
    await expect(cancelHostedAi(invoke, 'req-1')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(CANCEL_HOSTED_AI_COMMAND, { requestId: 'req-1' });
    await expect(cancelHostedAi(vi.fn(async () => 'yes'), 'r')).rejects.toMatchObject({
      name: 'DesktopBridgeError',
    });
  });
});
