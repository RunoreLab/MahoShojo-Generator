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

    expect(document.body.textContent).toContain('本地编辑与当前房间配置不同');
    expect(document.body.textContent).toContain('更新房间配置并开始');
    expect(document.body.textContent).toContain('按当前房间配置开始');
    for (const exposedTerm of ['host-local', 'working copy', 'Room baseline']) {
      expect(document.body.textContent).not.toContain(exposedTerm);
    }
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
    expect(document.body.textContent).not.toContain('working copy');
    expect(document.body.textContent).not.toContain('Room baseline');
  });

  it('有待处理提案时醒目提示继续生成不会应用提案', async () => {
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={[]}
        canUseRoom
        canPublish={false}
        pendingProposalCount={3}
        busy={false}
        onChoice={vi.fn()}
      />,
    ));

    expect(document.body.textContent).toContain('当前还有 3 个待处理提案');
    expect(document.body.textContent).toContain('继续生成不会应用这些提案');
    expect(document.body.textContent).not.toContain('当前本地编辑草稿无法发布');
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('两条启动路径都不可用时只提示重新同步或修正，不给出矛盾建议', async () => {
    await act(async () => root.render(
      <ArenaRoomGenerationPreflightDialog
        isOpen
        reasons={['working-copy-invalid', 'baseline-missing']}
        canUseRoom={false}
        canPublish={false}
        busy={false}
        onChoice={vi.fn()}
      />,
    ));

    expect(document.body.textContent).toContain('既无法安全发布本地草稿，也缺少可恢复的房间配置');
    expect(document.body.textContent).toContain('请取消后重新同步或修正编辑内容');
    expect(document.body.textContent).not.toContain('请显式更新房间或取消');
    expect(document.body.textContent).not.toContain('可以沿用已发布的房间配置');
    const actionButtons = [...document.body.querySelectorAll('button')].filter((button) => (
      button.textContent?.includes('开始')
    ));
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons.every((button) => button.disabled)).toBe(true);
  });
});
