// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaBackupNotice, DesktopArenaRecoveryControls, arenaRecoveryStatusLabel, buildArenaSafeDiagnostic } from '../src/features/arena/recovery-controls';
import { parseArenaFailureDiagnostic } from '../src/features/arena/failure-diagnostic';

let container: HTMLDivElement, root: Root;
const props = () => ({
  scopeKey: 'fixture-scope', pointer: { state: 'unknown', actor: { kind: 'account' as const, expectedUserId: 1234567 }, requestId: 'private-request-fixture' },
  showRecoveryCheck: true, recoveryError: null, blocked: false, disabled: false, identityReady: true, diagnosing: false,
  hint: null, diagnostic: null, backupFeedback: null,
  onRestore: vi.fn(), onDiagnose: vi.fn(), onDiscard: vi.fn(), onExport: vi.fn(),
});
const button = (text: string) => [...container.querySelectorAll('button')].find(item => item.textContent === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn().mockReturnValue(true) });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('safe Arena diagnostic projection', () => {
  it('projects only bounded allowlisted protocol values and fixed local explanations', () => {
    const response = { httpStatus: 401, code: 'UNAUTHORIZED', error: 'private upstream message', requestId: 'private-id' };
    const hosted = { connectionState: 'unknown', serverStatus: 'running', outputValidation: 'pending',
      companion: { privateField: 'private-body' }, validationMessage: 'private account', account: 1234567 };
    const summary = buildArenaSafeDiagnostic({ phase: 'failed', response, hosted })!;
    expect(summary).toContain('HTTP：401'); expect(summary).toContain('错误码：UNAUTHORIZED');
    expect(summary).toContain('任务状态：running'); expect(summary).toContain('不会重新生成');
    expect(summary).not.toMatch(/private|1234567|companion/);
  });
  it('redacts unknown codes and untrusted status strings without printing them', () => {
    const summary = buildArenaSafeDiagnostic({ phase: 'failed', response: { httpStatus: Number.NaN, code: 'ACCOUNT_SECRET_FIXTURE' },
      hosted: { connectionState: 'constructor', serverStatus: 'private account', outputValidation: 'private body' } })!;
    expect(summary).toContain('HTTP：未记录'); expect(summary).toContain('错误码：UNRECOGNIZED_ERROR');
    expect(summary).toContain('连接状态：unknown'); expect(summary).toContain('任务状态：未确认');
    expect(summary).not.toMatch(/ACCOUNT_SECRET_FIXTURE|private|constructor/);
    expect(arenaRecoveryStatusLabel('constructor')).toBe('尚未确认上次生成的结果');
    expect(arenaRecoveryStatusLabel('cancelled')).toContain('最终状态请再查询');
    expect(arenaRecoveryStatusLabel('failed')).toBe('上次生成或交付未完成');
  });
  it('does not invent HTTP or classify a successful or idle run as failure', () => {
    expect(buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null })).toContain('生成方式：未记录');
    expect(buildArenaSafeDiagnostic({ phase: 'idle', hosted: null, response: null })).toBeNull();
    expect(buildArenaSafeDiagnostic({ phase: 'completed', hosted: null, response: null })).toBeNull();
    expect(buildArenaSafeDiagnostic({ phase: 'failed', location: 'client', hosted: null, response: null })).toContain('生成方式：客户端');
    expect(buildArenaSafeDiagnostic({ phase: 'failed', hosted: { connectionState: 'failed', serverStatus: null, outputValidation: 'invalid' }, response: { httpStatus: null, code: 'GENERATION_FAILED' } })).toContain('HTTP：未记录');
  });
});

describe('Arena recovery controls', () => {
  it('explains recovery without showing request or account identifiers and preserves explicit actions', async () => {
    const value = props(); await act(async () => root.render(<DesktopArenaRecoveryControls {...value} />));
    expect(container.textContent).toContain('尚未确认上次生成的结果');
    expect(container.textContent).toContain('不会重新生成');
    expect(container.textContent).not.toMatch(/1234567|private-request-fixture|unknown/);
    expect(button('检查恢复条件')).toBeUndefined();
    await click('找回上次战报'); expect(value.onRestore).toHaveBeenCalledTimes(1);
    await click('下载会话备份'); expect(value.onExport).toHaveBeenCalledTimes(1);
    expect(value.onDiagnose).not.toHaveBeenCalled(); expect(value.onDiscard).not.toHaveBeenCalled();
    await click('问题排查'); await click('检查恢复条件'); expect(value.onDiagnose).toHaveBeenCalledTimes(1);
  });
  it('keeps identity lookup folded and never shows its request identifier', async () => {
    const value = props(); const hint = { product: 'battle' as const, state: 'available' as const, requestId: 'private-native-fixture', actorKind: 'anonymous' as const };
    await act(async () => root.render(<DesktopArenaRecoveryControls {...value} hint={hint} />));
    await click('问题排查'); expect(container.textContent).toContain('已找到上次访问身份');
    expect(container.textContent).not.toContain('private-native-fixture');
  });
  it('never disables backup because recovery or generation is blocked', async () => {
    const value = props(); await act(async () => root.render(<DesktopArenaRecoveryControls {...value} disabled blocked identityReady={false} recoveryError="恢复记录无法读取，原件已保留。" />));
    expect(button('找回上次战报').disabled).toBe(true); expect(button('清除损坏的恢复记录').disabled).toBe(true);
    expect(button('下载会话备份').disabled).toBe(false); await click('下载会话备份'); expect(value.onExport).toHaveBeenCalledTimes(1);
  });
  it('reports download initiation or failure without claiming the file has been saved', async () => {
    await act(async () => root.render(<ArenaBackupNotice feedback="download-started" />));
    expect(container.textContent).toContain('已发起下载'); expect(container.textContent).toContain('系统保存提示或下载目录');
    expect(container.textContent).toContain('arena-complete.json'); expect(container.textContent).toContain('无法确认文件是否已保存');
    await act(async () => root.render(<ArenaBackupNotice feedback="failed" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('未能发起下载');
    expect(container.textContent).not.toContain('已发起下载');
  });
  it('copies only the displayed safe summary and supports failure fallback', async () => {
    const value = props(), diagnostic = 'HTTP：401\n错误码：UNAUTHORIZED';
    await act(async () => root.render(<DesktopArenaRecoveryControls {...value} diagnostic={diagnostic} />));
    await click('问题排查'); await click('复制错误摘要');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(diagnostic); expect(container.textContent).toContain('错误摘要已复制');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('clipboard unavailable')); vi.mocked(document.execCommand).mockReturnValue(false);
    await click('复制错误摘要'); expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(container.textContent).toContain('复制失败'); expect(document.querySelector('textarea')).toBeNull();
  });
  it.each(['scope', 'diagnostic', 'unmount'] as const)('prevents stale copy fallback and feedback after %s changes', async change => {
    let reject!: (reason: unknown) => void; const flight = new Promise<void>((_resolve, fail) => { reject = fail; });
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => flight);
    const value = props(); await act(async () => root.render(<DesktopArenaRecoveryControls {...value} diagnostic="HTTP：401" />));
    await click('问题排查');
    await act(async () => { const copyButton = button('复制错误摘要'); copyButton.click(); copyButton.click(); });
    expect(button('正在复制…').disabled).toBe(true); expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    await act(async () => root.render(change === 'unmount' ? null : <DesktopArenaRecoveryControls {...value} scopeKey={change === 'scope' ? 'new-scope' : value.scopeKey} diagnostic={change === 'diagnostic' ? 'HTTP：502' : 'HTTP：401'} />));
    await act(async () => { reject(new Error('late clipboard error')); await Promise.resolve(); });
    expect(document.execCommand).not.toHaveBeenCalled(); expect(container.textContent).not.toMatch(/错误摘要已复制|复制失败/);
  });
});


describe('safe native failure category projection', () => {
  it('retains closed termination evidence through saved diagnostic parsing and copy', () => {
    const saved = JSON.stringify({ source: 'client', stage: 'output', code: 'incomplete-output', terminalStatus: 'completed',
      finishReason: 'length', outputChars: 256, model: 'PRIVATE-MODEL', message: 'PRIVATE-MESSAGE', text: 'PRIVATE-STORY' });
    const failureDiagnostic = parseArenaFailureDiagnostic(JSON.parse(saved));
    expect(failureDiagnostic).toEqual({ source: 'client', stage: 'output', code: 'incomplete-output', terminalStatus: 'completed', finishReason: 'length', outputChars: 256 });
    const summary = buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null, failureDiagnostic });
    expect(summary).toContain('流终态：completed'); expect(summary).toContain('结束原因：length');
    expect(summary).toContain('已接收正文长度：256'); expect(summary).not.toContain('PRIVATE');
    expect(parseArenaFailureDiagnostic({ source: 'client', stage: 'output', code: 'incomplete-output' }))
      .toEqual({ source: 'client', stage: 'output', code: 'incomplete-output' });
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 'PRIVATE-LENGTH'])('discards unsafe termination evidence and length %s', outputChars => {
    const failureDiagnostic = { source: 'client', stage: 'output', code: 'incomplete-output', terminalStatus: 'PRIVATE-STATUS',
      finishReason: 'PRIVATE-REASON', outputChars };
    const summary = buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null, failureDiagnostic });
    expect(summary).not.toMatch(/PRIVATE|流终态|结束原因|已接收正文长度/);
    expect(parseArenaFailureDiagnostic({ ...failureDiagnostic, terminalStatus: 'unconfirmed', finishReason: 'stop' })).not.toHaveProperty('finishReason');
    expect(parseArenaFailureDiagnostic({ ...failureDiagnostic, source: 'server', terminalStatus: 'completed', finishReason: 'length', outputChars: 10 }))
      .toEqual({ source: 'server', stage: 'output', code: 'unclassified' });
  });
  it('includes a Direct category and phase, never arbitrary native fields', () => {
    const summary = buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null,
      failureDiagnostic: { source: 'client', stage: 'native-stream', code: 'missing-secret', message: 'private-key-canary', requestId: 'private-request' } });
    expect(summary).toContain('执行错误码：missing-secret'); expect(summary).toContain('失败阶段：native-stream');
    expect(summary).not.toContain('private-');
  });
  it('redacts code-shaped secrets and invalid stages rather than trusting saved diagnostics', () => {
    const summary = buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null,
      failureDiagnostic: { source: 'server', stage: 'create-stream', code: 'PRIVATE_KEY_CANARY', dispatchState: 'not-dispatched' } });
    expect(summary).toContain('执行错误码：unclassified'); expect(summary).toContain('发出状态：not-dispatched');
    expect(summary).not.toContain('PRIVATE_KEY_CANARY');
    expect(buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null,
      failureDiagnostic: { source: 'client', stage: 'PRIVATE_STAGE', code: 'missing-secret' } })).not.toMatch(/PRIVATE_STAGE|missing-secret/);
  });
});


it.each(['native-invoke-rejected', 'ipc-receipt-invalid', 'ipc-delivery-timeout', 'ipc-delivery-invalid'])('keeps delivery failure %s distinct from provider failures', code => {
  const summary = buildArenaSafeDiagnostic({ phase: 'failed', hosted: null, response: null,
    failureDiagnostic: { source: 'client', stage: 'native-stream', code } });
  expect(summary).toContain(`执行错误码：${code}`);
});


it('distinguishes an absent response from an HTTP rejection and legacy missing evidence', () => {
  const hosted = { connectionState: 'failed', serverStatus: null, outputValidation: 'pending' };
  const summarize = (responseStatus?: number | null) => buildArenaSafeDiagnostic({ phase: 'failed', hosted: { ...hosted, responseStatus }, response: null });
  expect(summarize(null)).toContain('响应：尚未收到');
  expect(summarize()).toContain('响应：未记录');
  expect(summarize(401)).toContain('响应：已收到'); expect(summarize(401)).toContain('HTTP：401');
  expect(summarize(200)).toContain('HTTP：200');
  expect(summarize(Number.NaN)).toContain('响应：未记录'); expect(summarize(Number.NaN)).toContain('HTTP：未记录');
});
