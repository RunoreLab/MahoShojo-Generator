// @vitest-environment jsdom

import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useResultAutoScroll } from '@/lib/use-result-auto-scroll';

const scrollIntoView = vi.fn();
let container: HTMLDivElement;
let root: Root;
let currentTop = 0;

const Harness = ({ hasResult }: { hasResult: boolean }) => {
  const targetRef = useRef<HTMLDivElement | null>(null);
  useResultAutoScroll(targetRef, hasResult);
  return <div ref={targetRef}>结果</div>;
};

const render = async (hasResult: boolean) => {
  await act(async () => root.render(<Harness hasResult={hasResult} />));
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  currentTop = 0;
  // useEffect 在 render 内同步读取几何信息——必须在挂载前装好 prototype 替身。
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return { top: currentTop } as DOMRect;
  });
  Element.prototype.scrollIntoView = scrollIntoView;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('details 结果自动滚动', () => {
  it('结果整体仍在视口下方时自动定位一次', async () => {
    currentTop = window.innerHeight + 400;
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it.each([
    ['部分可见', window.innerHeight - 1],
    ['完全可见', 0],
    ['已滚过结果', -600],
  ])('结果%s时不打断用户位置（top=%i）', async (_label, top) => {
    currentTop = top;
    await render(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('同一结果会话内不重复滚动——流式增量与重渲染不拉扯视口', async () => {
    currentTop = window.innerHeight + 400;
    await render(true);
    // 快速随机/生成完成各只算一次结果会话；此后内容更新不再触发。
    await render(true);
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('结果清空后再次出现视为新会话，重新定位', async () => {
    currentTop = window.innerHeight + 400;
    await render(true);
    await render(false);
    currentTop = window.innerHeight + 400;
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('无结果时不产生任何滚动', async () => {
    currentTop = window.innerHeight + 400;
    await render(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('命中 prefers-reduced-motion 时退化为瞬时滚动', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    currentTop = window.innerHeight + 400;
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('data-motion 根标记（设置页显式「减少」）同样退化为瞬时滚动', async () => {
    document.documentElement.dataset.motion = 'reduce';
    currentTop = window.innerHeight + 400;
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    delete document.documentElement.dataset.motion;
  });

  it('设备偏好关闭「结果自动定位」后不滚动，重新开启对新会话生效', async () => {
    window.localStorage.setItem('mahoshojo.result-auto-scroll', 'off');
    currentTop = window.innerHeight + 400;
    await render(true);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // 重开 + 新结果会话（先清空再出现）→ 恢复定位。
    window.localStorage.setItem('mahoshojo.result-auto-scroll', 'on');
    await render(false);
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    window.localStorage.removeItem('mahoshojo.result-auto-scroll');
  });
});
