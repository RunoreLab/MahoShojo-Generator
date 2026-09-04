// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useArenaRoomAutoTitle } from '@/components/arena/multiplayer/useArenaRoomAutoTitle';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const Harness = ({ displayName }: { readonly displayName: string }) => {
  const [roomTitle, setRoomTitle] = useArenaRoomAutoTitle(displayName);
  return (
    <div>
      <input
        aria-label="room-title"
        value={roomTitle}
        onChange={(event) => setRoomTitle(event.target.value)}
      />
    </div>
  );
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const titleValue = (): string => (
  (container.querySelector('input') as HTMLInputElement).value
);

const setTitle = async (value: string): Promise<void> => {
  const input = container.querySelector('input') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      ?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('useArenaRoomAutoTitle', () => {
  it('用户名异步到达后自动标题跟随更新（回归：标题停留在「玩家 的房间」）', async () => {
    await act(async () => root.render(<Harness displayName="玩家" />));
    await flush();
    expect(titleValue()).toBe('玩家 的房间');

    await act(async () => root.render(<Harness displayName="Alice" />));
    await flush();
    expect(titleValue()).toBe('Alice 的房间');
  });

  it('用户手动修改标题后，displayName 变化不再覆盖', async () => {
    await act(async () => root.render(<Harness displayName="玩家" />));
    await flush();
    await setTitle('我的秘密基地');

    await act(async () => root.render(<Harness displayName="Alice" />));
    await flush();
    expect(titleValue()).toBe('我的秘密基地');
  });
});
