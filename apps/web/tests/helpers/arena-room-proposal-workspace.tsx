/**
 * `ArenaRoomProposalWorkspace` 相关用例共用的夹具与 DOM 生命周期。
 *
 * 单独成文件有两个原因：
 *
 * 1. **不复制作废逻辑。** `arena-room-proposal-workspace.test.tsx` 与
 *    `arena-room-proposal-workspace-reference-budget.test.tsx` 需要同一份 shared config、
 *    同一份 controller state 和同一组按钮查询助手。复制会让「预算上限」「history 开关」这类
 *    契约在两处漂移，而这类漂移正是字节级镜像那类门禁要防的东西。
 * 2. **共用夹具不破坏测试隔离。** 隔离要靠的是**全新的 jsdom 环境与空堆**，不是夹具独立；
 *    这里导出的全是纯数据与纯函数，没有模块级可变状态。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomControllerState } from '@/lib/arena-room/controller';

export const sharedConfig: ArenaRoomSharedConfig = {
  battleMode: 'classic',
  combatants: [{
    key: 'data-card:character-base',
    ref: {
      id: 'character-base',
      kind: 'character',
      versionToken: 'version-character-base',
    },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'default',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
};

export const member = {
  userId: 'member-1',
  role: 'member' as const,
  displayName: '成员',
  membershipState: 'active' as const,
};

export const buildArenaRoomState = (
  override?: ArenaRoomSharedConfig,
): ArenaRoomControllerState => {
  const effective = override ?? sharedConfig;
  return {
    phase: 'connected',
    rooms: [],
    notice: null,
    error: null,
    unknownOperation: null,
    proposalOperation: null,
    proposalResultUnknown: false,
    session: {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      self: member,
      snapshot: {
        protocolVersion: 1,
        schemaVersion: 1,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        revision: 7,
        controlSeq: 0,
        sharedConfig: effective,
        members: [member],
        proposals: [],
        activeGeneration: null,
      },
    },
  };
};

export const state = buildArenaRoomState();

export const setValue = (
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void => {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

export const createArenaWorkspaceQueries = (): Readonly<{
  button: (label: string) => HTMLButtonElement;
  buttonsWithText: (label: string) => HTMLButtonElement[];
  buttonContaining: (label: string) => HTMLButtonElement;
}> => ({
  button: (label) => {
    const target = [...document.body.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === label);
    if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
    return target;
  },
  buttonsWithText: (label) => [...document.body.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === label),
  buttonContaining: (label) => {
    const target = [...document.body.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes(label));
    if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found containing: ${label}`);
    return target;
  },
});

export const openArenaWorkspaceDom = (): Readonly<{ container: HTMLDivElement; root: Root }> => {
  localStorage.clear();
  const container = document.createElement('div');
  document.body.append(container);
  return { container, root: createRoot(container) };
};

export const closeArenaWorkspaceDom = async (
  container: HTMLDivElement,
  root: Root,
): Promise<void> => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
};