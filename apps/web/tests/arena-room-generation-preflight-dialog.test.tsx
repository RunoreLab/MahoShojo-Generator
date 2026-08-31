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

describe('Arena Room generation preflight dialog', () => {
  it('展示三个显式选择并转发用户意图', async () => {
    const onChoice = vi.fn();
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['shared-config', 'host-local-content']}
        canUseRoom
        canPublish
        busy={false}
        onChoice={onChoice}
      />,
    ));

    expect(document.body.textContent).toContain('本地编辑与房间权威配置不同');
    expect(document.body.textContent).toContain('更新房间配置并开始');
    expect(document.body.textContent).toContain('按当前房间配置开始');
    const useRoom = [...document.body.querySelectorAll('button')].find((button) => (
      button.textContent?.includes('按当前房间配置开始')
    ));
    if (!(useRoom instanceof HTMLButtonElement)) throw new Error('use-room button missing');
    await act(async () => useRoom.click());
    expect(onChoice).toHaveBeenCalledWith('use-room');
  });

  it('无 baseline 时禁用按房间启动，但仍可显式发布或取消', async () => {
    const onChoice = vi.fn();
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['baseline-missing']}
        canUseRoom={false}
        canPublish
        busy={false}
        onChoice={onChoice}
      />,
    ));
    const buttons = [...document.body.querySelectorAll('button')];
    const useRoom = buttons.find((button) => button.textContent?.includes('按当前房间配置开始'));
    expect(useRoom).toHaveProperty('disabled', true);
    const publish = buttons.find((button) => button.textContent?.includes('更新房间配置并开始'));
    if (!(publish instanceof HTMLButtonElement)) throw new Error('publish button missing');
    await act(async () => publish.click());
    expect(onChoice).toHaveBeenCalledWith('publish');
  });

  it('working copy 无法安全投影时禁用发布，但允许沿用已发布 Room baseline', async () => {
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['working-copy-invalid']}
        canUseRoom
        canPublish={false}
        busy={false}
        onChoice={vi.fn()}
      />,
    ));
    const buttons = [...document.body.querySelectorAll('button')];
    expect(buttons.find((button) => button.textContent?.includes('更新房间配置并开始')))
      .toHaveProperty('disabled', true);
    expect(buttons.find((button) => button.textContent?.includes('按当前房间配置开始')))
      .toHaveProperty('disabled', false);
  });
});
