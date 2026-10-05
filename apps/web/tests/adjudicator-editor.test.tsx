// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaRoomHostRuntimeGenerationSchema } from '@mahoshojo/contracts/arena-room';

import AdjudicatorEditor from '@/components/AdjudicatorEditor';
import type { AdjudicatorEvent } from '@/types/arena';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('AdjudicatorEditor 连锁事件删除', () => {
  it.each([
    { field: 'onSuccess', label: '成功', type: 'binary' },
    { field: 'onFailure', label: '失败', type: 'binary' },
    { field: 'chainedEvent', label: '结果1', type: 'custom' },
  ] as const)('添加并删除 $field 后同步输出可用于多人生成的事件，且不改写输入', async ({ field, label, type }) => {
    const initialEvents: AdjudicatorEvent[] = [{
      id: 'root-event',
      description: '触发判定',
      type,
      probability: 50,
      ...(type === 'custom' ? {
        outcomes: [{ id: 'outcome-1', name: '结果1', probability: 100 }],
      } : {}),
    }];
    const initialSnapshot = JSON.parse(JSON.stringify(initialEvents));
    const onEventsChange = vi.fn<(events: AdjudicatorEvent[]) => void>();
    await act(async () => root.render(
      <AdjudicatorEditor events={initialEvents} onEventsChange={onEventsChange} />,
    ));
    expect(onEventsChange).not.toHaveBeenCalled();

    const addButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === `+ 添加【${label}】后续事件`,
    );
    if (!addButton) throw new Error('后续事件添加按钮缺失');
    await act(async () => addButton.click());

    expect(onEventsChange).toHaveBeenCalledTimes(1);
    const addedEvents = onEventsChange.mock.calls[0][0];
    const addedOwner = field === 'chainedEvent' ? addedEvents[0].outcomes![0] : addedEvents[0];
    expect(addedOwner).toHaveProperty(field);
    expect(initialEvents).toStrictEqual(initialSnapshot);
    const addedSnapshot = JSON.parse(JSON.stringify(addedEvents));

    await act(async () => root.render(
      <AdjudicatorEditor events={addedEvents} onEventsChange={onEventsChange} />,
    ));
    onEventsChange.mockClear();
    const nestedDescription = container.querySelectorAll('textarea')[1];
    const deleteButton = nestedDescription?.parentElement?.querySelector('button');
    if (!deleteButton) throw new Error('后续事件删除按钮缺失');
    await act(async () => deleteButton.click());

    // 直接验证首次回调，不依赖父组件重新渲染后 useEffect 再次清理。
    expect(onEventsChange).toHaveBeenCalledTimes(1);
    const removedEvents = onEventsChange.mock.calls[0][0];
    const removedOwner = field === 'chainedEvent' ? removedEvents[0].outcomes![0] : removedEvents[0];
    expect(Object.prototype.hasOwnProperty.call(removedOwner, field)).toBe(false);
    expect(ArenaRoomHostRuntimeGenerationSchema.safeParse({
      adjudicationEvents: removedEvents,
    }).success).toBe(true);
    expect(removedEvents).toStrictEqual(initialSnapshot);
    expect(addedEvents).toStrictEqual(addedSnapshot);
    expect(initialEvents).toStrictEqual(initialSnapshot);
  });
});
