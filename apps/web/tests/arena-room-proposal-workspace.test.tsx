// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { createRoomProposalArenaEditorSession } from '@/components/arena/editor';
import { ArenaRoomProposalWorkspaceView } from '@/components/arena/multiplayer/ArenaRoomProposalWorkspace';
import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/config', () => ({
  config: { ENABLE_ARENA_USER_GUIDANCE: true },
}));

vi.mock('@/components/arena/hooks/useArenaData', () => ({
  useLanguagesQuery: () => ({
    data: [
      { code: 'zh-CN', name: '简体中文' },
      { code: 'en-US', name: 'English' },
    ],
  }),
}));

vi.mock('@/components/BattleDataModal', () => ({
  default: ({
    isOpen,
    onClose,
    visibleTabs,
    selectedType,
    titleOverride,
    onSelectCard,
    onToggleCard,
  }: {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly visibleTabs: readonly string[];
    readonly selectedType: string;
    readonly titleOverride?: string;
    readonly onSelectCard?: (card: unknown) => void;
    readonly onToggleCard?: (card: unknown, selected: boolean) => void;
  }) => {
    if (!isOpen) return null;
    const isAuxScenario = titleOverride === '选择辅助情景';
    const isMaterial = titleOverride === '选择素材';
    const actionLabel = selectedType === 'character'
      ? '模拟选择角色'
      : isAuxScenario
        ? '模拟选择辅助情景'
        : isMaterial
          ? '模拟选择素材'
          : '模拟选择主情景';
    const kind = selectedType === 'character'
      ? 'character'
      : isMaterial ? 'material' : 'scenario';
    const id = selectedType === 'character'
      ? 'character-public-1'
      : isAuxScenario
        ? 'scenario-public-aux'
        : isMaterial
          ? 'material-public-1'
          : 'scenario-public-main';
    const select = () => {
      const card = { _cardId: id, _updatedAt: `version-${id}`, type: kind };
      if (onSelectCard) onSelectCard(card);
      else onToggleCard?.(card, true);
    };
    return (
      <div
        data-testid="battle-data-modal"
        data-visible-tabs={visibleTabs.join(',')}
        data-selected-type={selectedType}
      >
        <button type="button" onClick={select}>{actionLabel}</button>
        <button type="button" onClick={onClose}>关闭数据卡</button>
      </div>
    );
  },
}));

const sharedConfig: ArenaRoomSharedConfig = {
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

const member = {
  userId: 'member-1',
  role: 'member' as const,
  displayName: '成员',
  membershipState: 'active' as const,
};

const state: ArenaRoomControllerState = {
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
      sharedConfig,
      members: [member],
      proposals: [],
      activeGeneration: null,
    },
  },
};

const setValue = (
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

let container: HTMLDivElement;
let root: Root;

const button = (label: string): HTMLButtonElement => {
  const target = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return target;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Arena room Proposal workspace', () => {
  it('复用 Arena 编辑控件产生完整 typed diff，且公开数据卡不携带正文', async () => {
    const editor = createRoomProposalArenaEditorSession({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 7,
      sharedConfig,
    });
    const controller = {
      submitProposal: vi.fn(async () => undefined),
    } satisfies Pick<ArenaRoomController, 'submitProposal'>;

    await act(async () => root.render(
      <ArenaRoomProposalWorkspaceView editor={editor} state={state} controller={controller} />,
    ));

    await act(async () => button('浏览在线角色库').click());
    const modal = container.querySelector('[data-testid="battle-data-modal"]');
    expect(modal?.getAttribute('data-visible-tabs')).toBe('public,recommended');
    expect(container.textContent).not.toContain('上传');
    expect(container.textContent).not.toContain('粘贴');
    await act(async () => button('模拟选择角色').click());
    await act(async () => button('关闭数据卡').click());

    const guidance = container.querySelector<HTMLTextAreaElement>('#arena-roster-guidance-data-card\\:character-public-1');
    if (!guidance) throw new Error('character guidance not found');
    await act(async () => setValue(guidance, '优先保护同伴'));

    const teamName = container.querySelector<HTMLInputElement>('input[placeholder="新队伍名称"]');
    if (!teamName) throw new Error('team name input not found');
    await act(async () => setValue(teamName, '守护队'));
    await act(async () => button('新增队伍').click());
    const teamSelect = [...container.querySelectorAll<HTMLSelectElement>('select:not(#language-select)')].at(-1);
    const teamKey = teamSelect?.options[1]?.value;
    if (!teamSelect || !teamKey) throw new Error('team assignment select not found');
    await act(async () => setValue(teamSelect, teamKey));

    await act(async () => button('情景模式📜').click());
    await act(async () => button('浏览在线情景库').click());
    await act(async () => button('模拟选择主情景').click());
    await act(async () => button('选择辅助情景').click());
    await act(async () => button('模拟选择辅助情景').click());
    await act(async () => button('关闭数据卡').click());
    await act(async () => button('浏览在线数据卡').click());
    await act(async () => button('模拟选择素材').click());
    await act(async () => button('关闭数据卡').click());

    const storyGuidance = container.querySelector<HTMLInputElement>('#arena-story-guidance');
    const language = container.querySelector<HTMLSelectElement>('#language-select');
    if (!storyGuidance || !language) throw new Error('shared story controls not found');
    await act(async () => setValue(storyGuidance, '雨夜守城'));
    await act(async () => button('标准(600+)').click());
    await act(async () => setValue(language, 'en-US'));

    const narrativeRead = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('生成时读取（用于延续剧情）'))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!narrativeRead) throw new Error('narrative history checkbox not found');
    await act(async () => narrativeRead.click());

    await act(async () => button('预览提案').click());
    expect(container.textContent).toContain('BASE revision 7');
    expect(container.textContent).toContain('PROPOSED：');
    expect(container.textContent).toContain('将提交');
    expect(container.textContent).toContain('新增角色');
    expect(container.textContent).toContain('新增队伍');
    expect(container.textContent).toContain('主情景改为 scenario-public-main');
    expect(container.textContent).toContain('新增辅助情景');
    expect(container.textContent).toContain('新增素材');
    expect(container.textContent).toContain('语言改为 en-US');

    await act(async () => {
      button('提交 Proposal').click();
      await Promise.resolve();
    });

    expect(controller.submitProposal).toHaveBeenCalledOnce();
    const intent = vi.mocked(controller.submitProposal).mock.calls[0]?.[0];
    expect(intent).toMatchObject({
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 7,
    });
    const changes = intent?.changes ?? [];
    expect(changes.map((change) => change.type)).toEqual(expect.arrayContaining([
      'addCombatant',
      'setCharacterGuidance',
      'addTeam',
      'assignTeam',
      'setBattleMode',
      'setScenario',
      'addAuxScenario',
      'addMaterial',
      'setUserGuidance',
      'setStoryLength',
      'setSelectedLanguage',
      'setHistorySettings',
    ]));
    expect(JSON.stringify(intent)).not.toContain('"content"');
    expect(JSON.stringify(intent)).not.toContain('"data"');
    expect(intent?.changes.find((change) => change.type === 'addCombatant')).toMatchObject({
      ref: {
        id: 'character-public-1',
        kind: 'character',
        versionToken: 'version-character-public-1',
      },
    });
    editor.dispose();
  });
});
