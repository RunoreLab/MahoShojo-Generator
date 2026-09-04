// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArenaRoomGenerationPreflightDialog } from '@/components/arena/multiplayer/ArenaRoomGenerationPreflightDialog';

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

const findButton = (text: string): HTMLButtonElement | undefined => (
  [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(text))
);

describe('Arena Room generation preflight dialog', () => {
  it('dirty 场景展示发布、同步房间配置与取消，转发同步选择', async () => {
    const onChoice = vi.fn();
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['shared-config', 'host-local-content']}
        canPublish
        canConfirmStart={false}
        busy={false}
        onChoice={onChoice}
      />,
    ));

    expect(document.body.textContent).toContain('本地编辑与当前房间配置不同');
    expect(document.body.textContent).toContain('更新房间配置并开始');
    expect(document.body.textContent).toContain('放弃本地修改，同步房间配置');
    expect(document.body.textContent).toContain('完成后再点击一次开始生成');
    for (const exposedTerm of ['host-local', 'working copy', 'Room baseline']) {
      expect(document.body.textContent).not.toContain(exposedTerm);
    }
    const syncRoom = findButton('放弃本地修改，同步房间配置');
    if (!(syncRoom instanceof HTMLButtonElement)) throw new Error('sync-room button missing');
    await act(async () => syncRoom.click());
    expect(onChoice).toHaveBeenCalledWith('sync-room');
  });

  it('working copy 无法安全投影时禁用发布，但仍可显式同步房间配置', async () => {
    const onChoice = vi.fn();
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['working-copy-invalid']}
        canPublish={false}
        canConfirmStart={false}
        busy={false}
        onChoice={onChoice}
      />,
    ));
    expect(findButton('更新房间配置并开始')).toHaveProperty('disabled', true);
    const syncRoom = findButton('放弃本地修改，同步房间配置');
    expect(syncRoom).toHaveProperty('disabled', false);
    expect(document.body.textContent).toContain('当前本地编辑草稿无法安全发布');
    if (!(syncRoom instanceof HTMLButtonElement)) throw new Error('sync-room button missing');
    await act(async () => syncRoom.click());
    expect(onChoice).toHaveBeenCalledWith('sync-room');
  });

  it('本地干净但有待处理提案时只提供确认开始与取消，不提供发布/同步', async () => {
    const onChoice = vi.fn();
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={[]}
        canPublish={false}
        canConfirmStart
        pendingProposalCount={3}
        busy={false}
        onChoice={onChoice}
      />,
    ));

    expect(document.body.textContent).toContain('当前还有 3 个待处理提案');
    expect(document.body.textContent).toContain('继续生成不会应用这些提案');
    expect(document.body.textContent).not.toContain('当前本地编辑草稿无法发布');
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    const confirmStart = findButton('确认按当前配置开始');
    if (!(confirmStart instanceof HTMLButtonElement)) throw new Error('confirm-start button missing');
    expect(findButton('放弃本地修改，同步房间配置')).toBeUndefined();
    expect(findButton('更新房间配置并开始')).toBeUndefined();
    await act(async () => confirmStart.click());
    expect(onChoice).toHaveBeenCalledWith('confirm-start');
  });

  it('busy 期间禁用全部动作', async () => {
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['baseline-missing']}
        canPublish
        canConfirmStart={false}
        busy
        onChoice={vi.fn()}
      />,
    ));
    expect(findButton('更新房间配置并开始')).toHaveProperty('disabled', true);
    expect(findButton('放弃本地修改，同步房间配置')).toHaveProperty('disabled', true);
    expect(findButton('取消')).toHaveProperty('disabled', true);
  });
});
