// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

import { createRoomProposalArenaEditorSession } from '@/components/arena/editor';
import { ArenaRoomProposalWorkspaceView } from '@/components/arena/multiplayer/ArenaRoomProposalWorkspace';
import { arenaProposalExpectedBaseSummary } from '@/components/arena/multiplayer/ArenaProposalPanel';
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
    selectedCardIds,
    allowDeckImport,
    allowCardDetails,
  }: {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly visibleTabs: readonly string[];
    readonly selectedType: string;
    readonly titleOverride?: string;
    readonly onSelectCard?: (card: unknown) => void;
    readonly onToggleCard?: (card: unknown, selected: boolean) => void;
    readonly selectedCardIds?: readonly string[];
    readonly allowDeckImport?: boolean;
    readonly allowCardDetails?: boolean;
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
        data-selected-card-ids={selectedCardIds?.join(',') ?? ''}
        data-allow-deck-import={String(allowDeckImport)}
        data-allow-card-details={String(allowCardDetails)}
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
  const target = [...document.body.querySelectorAll('button')]
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
  vi.unstubAllGlobals();
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
      withdrawProposal: vi.fn(async () => undefined),
      reconnect: vi.fn(),
    } satisfies Pick<ArenaRoomController, 'reconnect' | 'submitProposal' | 'withdrawProposal'>;

    await act(async () => root.render(
      <ArenaRoomProposalWorkspaceView editor={editor} state={state} controller={controller} />,
    ));

    expect(container.textContent).toContain('🎴 预设角色');
    expect(container.textContent).toContain('选择预设魔法少女');
    expect(container.textContent).toContain('选择预设残兽');
    expect(container.textContent).toContain('🌐 在线角色库 / 随机匹配');
    expect(container.textContent).not.toContain('选择内置预设角色');

    const curatedPresetToggle = container.querySelector<HTMLButtonElement>('button[aria-label="选择预设角色：翠雀"]');
    if (!curatedPresetToggle) throw new Error('curated preset picker item not found');
    await act(async () => curatedPresetToggle.click());

    await act(async () => button('浏览在线角色库').click());
    const modal = container.querySelector('[data-testid="battle-data-modal"]');
    expect(modal?.getAttribute('data-visible-tabs')).toBe('public,recommended');
    expect(modal?.getAttribute('data-allow-deck-import')).toBe('false');
    expect(modal?.getAttribute('data-allow-card-details')).toBe('false');
    expect(container.textContent).not.toContain('上传');
    expect(container.textContent).not.toContain('粘贴');
    await act(async () => button('模拟选择角色').click());
    await act(async () => button('关闭数据卡').click());

    const guidance = container.querySelector<HTMLTextAreaElement>('#arena-roster-guidance-data-card\\:character-public-1');
    if (!guidance) throw new Error('character guidance not found');
    await act(async () => setValue(guidance, '优先保护同伴'));
    expect(container.querySelector('label[for="arena-roster-guidance-data-card:character-public-1"]')?.textContent)
      .toContain('角色行动引导');
    const guidanceRow = guidance.closest('.group');
    const collapseGuidanceButton = [...(guidanceRow?.querySelectorAll('button') ?? [])]
      .find((candidate) => candidate.textContent?.trim() === '收起');
    if (!(collapseGuidanceButton instanceof HTMLButtonElement)) throw new Error('guidance collapse button not found');
    await act(async () => collapseGuidanceButton.click());
    expect(container.querySelector('#arena-roster-guidance-data-card\\:character-public-1')).toBeNull();
    const reopenGuidanceButton = [...(guidanceRow?.querySelectorAll('button') ?? [])]
      .find((candidate) => candidate.textContent?.trim() === '行动');
    if (!(reopenGuidanceButton instanceof HTMLButtonElement)) throw new Error('guidance toggle button not found');
    await act(async () => reopenGuidanceButton.click());
    expect(container.querySelector('#arena-roster-guidance-data-card\\:character-public-1')).not.toBeNull();

    const teamName = container.querySelector<HTMLInputElement>('input[placeholder="新队伍名称"]');
    if (!teamName) throw new Error('team name input not found');
    expect(teamName.id).toBe('arena-room-proposal-new-team');
    expect(container.querySelector('label[for="arena-room-proposal-new-team"]')?.textContent)
      .toContain('新队伍名称');
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
    const curatedScenarioToggle = container.querySelector<HTMLButtonElement>('button[aria-label="选择预设情景：谨遵女王之意（A.R.E.N.A.）"]');
    if (!curatedScenarioToggle) throw new Error('curated scenario picker item not found');
    await act(async () => curatedScenarioToggle.click());
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

    const previewTrigger = button('预览提案');
    previewTrigger.focus();
    await act(async () => previewTrigger.click());
    expect(document.body.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe('关闭');
    expect(document.body.textContent).toContain('基于房间配置版本 7');
    expect(document.body.textContent).toContain('建议值：');
    expect(document.body.textContent).toContain('将提交');
    expect(document.body.textContent).toContain('新增角色');
    expect(document.body.textContent).toContain('新增队伍');
    expect(document.body.textContent).toContain('主情景改为 在线:scenario-public-main');
    expect(document.body.textContent).toContain('新增辅助情景');
    expect(document.body.textContent).toContain('新增素材');
    expect(document.body.textContent).toContain('语言改为 en-US');
    expect(document.body.textContent).toContain(
      '建议值：角色 data-card:character-public-1 引导改为“优先保护同伴”',
    );
    expect(document.body.textContent).toContain(
      '建议值：角色 data-card:character-public-1 分配至队伍 team:',
    );
    expect(document.body.textContent).toContain('叙事历史 读取=开(10)、写入=关');
    for (const exposedTerm of ['Proposal', 'typed diff', 'BASE', 'PROPOSED', 'revision', 'server-known', 'payload']) {
      expect(document.body.textContent).not.toContain(exposedTerm);
    }

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(previewTrigger);
    await act(async () => previewTrigger.click());

    await act(async () => {
      button('提交提案').click();
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
    expect(JSON.stringify(intent)).not.toContain('"payload"');
    expect(JSON.stringify(intent)).not.toContain('"sourcePath"');
    expect(intent?.changes.find((change) => change.type === 'addCombatant' && change.ref.id === 'character-public-1')).toMatchObject({
      ref: {
        id: 'character-public-1',
        kind: 'character',
        versionToken: 'version-character-public-1',
      },
    });
    expect(intent?.changes.find((change) => change.type === 'addCombatant' && change.ref.id === 'M01_centaurea.json')).toMatchObject({
      key: 'preset:M01_centaurea.json',
      ref: {
        id: 'M01_centaurea.json',
        versionToken: expect.stringMatching(/^sha256:/),
      },
    });
    expect(intent?.changes.find((change) => change.type === 'addAuxScenario' && change.ref.id === 'S01_queen_will.json')).toMatchObject({
      key: 'preset:S01_queen_will.json',
      ref: {
        kind: 'scenario',
        versionToken: expect.stringMatching(/^sha256:/),
      },
    });
    editor.dispose();
  });

  it('随机匹配复用公开角色入口并只写入 exact ref', async () => {
    const fetcher = vi.fn(async () => Response.json({
      success: true,
      card: {
        id: 'character-random-1',
        updated_at: 'version-character-random-1',
        type: 'character',
        content: { secret: '不得进入提案' },
      },
    }));
    vi.stubGlobal('fetch', fetcher);
    const editor = createRoomProposalArenaEditorSession({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 7,
      sharedConfig,
    });
    const controller = {
      submitProposal: vi.fn(async () => undefined),
      withdrawProposal: vi.fn(async () => undefined),
      reconnect: vi.fn(),
    } satisfies Pick<ArenaRoomController, 'reconnect' | 'submitProposal' | 'withdrawProposal'>;

    await act(async () => root.render(
      <ArenaRoomProposalWorkspaceView editor={editor} state={state} controller={controller} />,
    ));
    await act(async () => {
      button('随机匹配角色').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledWith('/api/random-public-card?type=character');
    const change = editor.preview().changes.find((item) => (
      item.type === 'addCombatant' && item.ref.id === 'character-random-1'
    ));
    expect(change).toMatchObject({
      ref: {
        kind: 'character',
        versionToken: 'version-character-random-1',
      },
    });
    expect(change).not.toHaveProperty('key');
    expect(JSON.stringify(change)).not.toContain('secret');
    editor.dispose();
  });

  it('expectedBase 摘要保留 preset namespace', () => {
    const change = {
      type: 'setScenario',
      changeId: 'scenario-preset-summary',
      key: 'preset:S01_queen_will.json',
      ref: {
        id: 'S01_queen_will.json',
        kind: 'scenario',
        versionToken: 'sha256:test',
      },
      expectedBase: {
        kind: 'ref',
        key: 'preset:S00_old.json',
        ref: {
          id: 'S00_old.json',
          kind: 'scenario',
          versionToken: 'sha256:old',
        },
      },
    } as const;
    expect(arenaProposalExpectedBaseSummary(change)).toBe('提案基准：preset:S00_old.json');
  });

  it('online data-card modal 不把仅存在于 preset namespace 的同名引用标为已选', async () => {
    const presetOnlyConfig: ArenaRoomSharedConfig = {
      ...sharedConfig,
      combatants: [{
        key: 'preset:character-public-1',
        ref: {
          id: 'character-public-1',
          kind: 'character',
          versionToken: 'sha256:preset',
        },
      }],
    };
    const editor = createRoomProposalArenaEditorSession({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 7,
      sharedConfig: presetOnlyConfig,
    });
    const presetOnlyState: ArenaRoomControllerState = {
      ...state,
      session: state.session ? {
        ...state.session,
        snapshot: { ...state.session.snapshot, sharedConfig: presetOnlyConfig },
      } : null,
    };
    const controller = {
      submitProposal: vi.fn(async () => undefined),
      withdrawProposal: vi.fn(async () => undefined),
      reconnect: vi.fn(),
    } satisfies Pick<ArenaRoomController, 'reconnect' | 'submitProposal' | 'withdrawProposal'>;

    await act(async () => root.render(
      <ArenaRoomProposalWorkspaceView editor={editor} state={presetOnlyState} controller={controller} />,
    ));
    await act(async () => button('浏览在线角色库').click());
    const modal = container.querySelector('[data-testid="battle-data-modal"]');
    expect(modal?.getAttribute('data-selected-card-ids')).toBe('');
    editor.dispose();
  });

  it('暴露共享列表移动控件并产生五类全序 typed change', async () => {
    const reorderableConfig: ArenaRoomSharedConfig = {
      ...sharedConfig,
      battleMode: 'scenario',
      combatants: [
        { key: 'data-card:character-one', ref: { id: 'character-one', kind: 'character', versionToken: 'v1' } },
        { key: 'data-card:character-two', ref: { id: 'character-two', kind: 'character', versionToken: 'v1' } },
        { key: 'data-card:character-three', ref: { id: 'character-three', kind: 'character', versionToken: 'v1' } },
      ],
      teams: [
        { key: 'team:a', displayName: 'A 队', combatantKeys: ['data-card:character-one', 'data-card:character-two'] },
        { key: 'team:b', displayName: 'B 队', combatantKeys: ['data-card:character-three'] },
      ],
      auxScenarios: [
        { key: 'data-card:aux-one', ref: { id: 'aux-one', kind: 'scenario', versionToken: 'v1' } },
        { key: 'data-card:aux-two', ref: { id: 'aux-two', kind: 'scenario', versionToken: 'v1' } },
      ],
      materials: [
        { key: 'data-card:material-one', ref: { id: 'material-one', kind: 'material', versionToken: 'v1' } },
        { key: 'data-card:material-two', ref: { id: 'material-two', kind: 'material', versionToken: 'v1' } },
      ],
    };
    const editor = createRoomProposalArenaEditorSession({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 7,
      sharedConfig: reorderableConfig,
    });
    const reorderState: ArenaRoomControllerState = {
      ...state,
      session: state.session ? {
        ...state.session,
        snapshot: { ...state.session.snapshot, sharedConfig: reorderableConfig },
      } : null,
    };
    const controller = {
      submitProposal: vi.fn(async () => undefined),
      withdrawProposal: vi.fn(async () => undefined),
      reconnect: vi.fn(),
    } satisfies Pick<ArenaRoomController, 'reconnect' | 'submitProposal' | 'withdrawProposal'>;

    await act(async () => root.render(
      <ArenaRoomProposalWorkspaceView editor={editor} state={reorderState} controller={controller} />,
    ));
    const move = async (label: string): Promise<void> => {
      const target = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!target) throw new Error(`move button not found: ${label}`);
      await act(async () => target.click());
    };

    await move('下移 character-one');
    await move('下移队伍 A 队');
    await move('下移 A 队内 character-one');
    await move('下移 aux-one');
    await move('下移 material-one');

    expect(editor.preview().changes.map((change) => change.type)).toEqual([
      'reorderCombatants',
      'reorderTeams',
      'reorderTeamCombatants',
      'reorderAuxScenarios',
      'reorderMaterials',
    ]);
    await act(async () => button('预览提案').click());
    expect(document.body.textContent).toContain('调整角色顺序');
    expect(document.body.textContent).toContain('调整队伍 team:a 内角色顺序');
    expect(document.body.textContent).toContain('调整素材顺序');
    editor.dispose();
  });
});
