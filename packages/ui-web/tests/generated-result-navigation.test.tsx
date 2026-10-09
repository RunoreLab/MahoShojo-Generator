// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneratedResultAutoScroll, useResultAutoScroll } from '../src/details-controls/use-result-auto-scroll';

let root: Root;
let host: HTMLDivElement;
let begin: ReturnType<typeof useGeneratedResultAutoScroll>;
let top: number;
const scroll = vi.fn();
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  begin = useGeneratedResultAutoScroll(ref);
  return <div ref={ref}>可预览正文</div>;
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  top = innerHeight + 100;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top }) as DOMRect);
  Element.prototype.scrollIntoView = scroll;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.motion; });
describe('请求绑定的首次可预览结果导航', () => {
  it('恢复/已有正文挂载不定位；等待结果可预览后才滚动一次', async () => {
    expect(scroll).not.toHaveBeenCalled();
    const ready = begin({});
    await act(async () => {});
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => ready());
    await act(async () => ready());
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('重复接入同一请求也不会重置已消费通知', async () => {
    const request = {}; const ready = begin(request);
    await act(async () => ready());
    const repeated = begin(request); await act(async () => repeated());
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('新请求使旧请求迟到通知失效；新结果可以再次定位', async () => {
    const old = begin({}); const fresh = begin({});
    await act(async () => old()); expect(scroll).not.toHaveBeenCalled();
    await act(async () => fresh()); expect(scroll).toHaveBeenCalledTimes(1);
    const next = begin({}); await act(async () => next());
    expect(scroll).toHaveBeenCalledTimes(2);
  });
  it('取消后残文通知和已排队但取消的通知均不滚动', async () => {
    const controller = new AbortController(); const ready = begin({}, controller.signal);
    controller.abort(); await act(async () => ready());
    const another = new AbortController(); const queued = begin({}, another.signal);
    await act(async () => { queued(); another.abort(); });
    expect(scroll).not.toHaveBeenCalled();
  });
  it('失败撤销只失效当前请求的排队导航，不取消后继请求', async () => {
    const failed = begin({}); await act(async () => { failed(); failed.cancel(); });
    expect(scroll).not.toHaveBeenCalled();
    const next = begin({}); failed.cancel(); await act(async () => next());
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('关闭偏好时消费通知，重新打开不追溯，下一请求生效', async () => {
    localStorage.setItem('mahoshojo.result-auto-scroll', 'off'); const ready = begin({});
    await act(async () => ready()); localStorage.setItem('mahoshojo.result-auto-scroll', 'on');
    await act(async () => ready()); expect(scroll).not.toHaveBeenCalled();
    const next = begin({}); await act(async () => next()); expect(scroll).toHaveBeenCalledTimes(1);
  });
  it.each([0, -100, innerHeight - 1])('用户已滚到/经过结果不拉扯：%s', async (value) => {
    top = value; const ready = begin({}); await act(async () => ready());
    top = innerHeight + 100; await act(async () => ready()); expect(scroll).not.toHaveBeenCalled();
  });
  it('减少动效使用瞬时滚动', async () => {
    document.documentElement.dataset.motion = 'reduce'; const ready = begin({});
    await act(async () => ready()); expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });
  it('Desktop恢复卡不冒充新生成，随后新卡正常定位', async () => {
    function Restored({ restored }: { restored: boolean }) {
      const ref = useRef<HTMLDivElement>(null); useResultAutoScroll(ref, true, { restored }); return <div ref={ref} />;
    }
    await act(async () => root.render(<Restored restored />)); expect(scroll).not.toHaveBeenCalled();
    await act(async () => root.render(<Restored restored={false} />)); expect(scroll).toHaveBeenCalledTimes(1);
  });
});
