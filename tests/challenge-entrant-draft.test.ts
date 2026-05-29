import { describe, expect, vi, test } from 'vitest';

import type { ChallengeEntrantDraftState } from '@/lib/challenge/entrant-draft';

describe('challenge entrant draft', () => {
  test('createEmptyEntrantDraft 会返回未选择角色的空草稿', async () => {
    const { createEmptyEntrantDraft } = await import('@/lib/challenge/entrant-draft');

    expect(createEmptyEntrantDraft()).toEqual({
      entrantCards: [],
      sourceMode: null,
      rawEditorText: '',
      lastAppliedEditorText: '',
      isEditorDirty: false,
    });
  });

  test('非编辑来源写入角色卡后会重置 dirty 状态', async () => {
    const { createDraftFromImportedCard } = await import('@/lib/challenge/entrant-draft');

    const draft = createDraftFromImportedCard({ codename: '雾灯' }, 'database');

    expect(draft.entrantCards).toEqual([{ codename: '雾灯' }]);
    expect(draft.isEditorDirty).toBe(false);
    expect(draft.lastAppliedEditorText).toBe(draft.rawEditorText);
    expect(draft.sourceMode).toBe('database');
  });

  test('编辑区内容变化后会进入 dirty 状态', async () => {
    const { createDraftFromImportedCard, markEditorTextChanged } = await import('@/lib/challenge/entrant-draft');

    const draft = createDraftFromImportedCard({ codename: '雾灯' }, 'database');
    const next = markEditorTextChanged(draft, '{"codename":"夜纱"}');

    expect(next.rawEditorText).toBe('{"codename":"夜纱"}');
    expect(next.isEditorDirty).toBe(true);
    expect(next.lastAppliedEditorText).not.toBe(next.rawEditorText);
  });

  test('applyEditorTextToDraft 成功后会清空 dirty 并切换 sourceMode=manual-json', async () => {
    const { applyEditorTextToDraft, createDraftFromImportedCard, markEditorTextChanged } = await import(
      '@/lib/challenge/entrant-draft'
    );

    const draft = markEditorTextChanged(createDraftFromImportedCard({ codename: '雾灯' }, 'database'), '{"codename":"夜纱"}');
    const next = await applyEditorTextToDraft(draft, async (text) => JSON.parse(text) as Record<string, unknown>);

    expect(next.entrantCards).toEqual([{ codename: '夜纱' }]);
    expect(next.sourceMode).toBe('manual-json');
    expect(next.lastAppliedEditorText).toBe('{"codename":"夜纱"}');
    expect(next.isEditorDirty).toBe(false);
  });

  test('resolveSourceCardForPrepare 在 dirty=true 时会先自动应用', async () => {
    const { createDraftFromImportedCard, markEditorTextChanged, resolveSourceCardForPrepare } = await import(
      '@/lib/challenge/entrant-draft'
    );

    const draft = markEditorTextChanged(createDraftFromImportedCard({ codename: '雾灯' }, 'database'), '{"codename":"夜纱"}');
    const parseCard = vi.fn(async (text: string) => JSON.parse(text) as Record<string, unknown>);

    const result = await resolveSourceCardForPrepare(draft, parseCard);

    expect(parseCard).toHaveBeenCalledTimes(1);
    expect(result.sourceCard).toEqual({ codename: '夜纱' });
    expect(result.draft.entrantCards).toEqual([{ codename: '夜纱' }]);
    expect(result.draft.isEditorDirty).toBe(false);
  });

  test('resolveSourceCardForPrepare 在已有 entrantCards[0] 且 dirty=false 时不会重新解析 editorText', async () => {
    const { createDraftFromImportedCard, resolveSourceCardForPrepare } = await import('@/lib/challenge/entrant-draft');

    const parseCard = vi.fn(async (_text: string) => ({ codename: '夜纱' }));
    const result = await resolveSourceCardForPrepare(createDraftFromImportedCard({ codename: '雾灯' }, 'database'), parseCard);

    expect(parseCard).toHaveBeenCalledTimes(0);
    expect(result.sourceCard).toEqual({ codename: '雾灯' });
  });

  test('当前没有已应用角色卡时，prepare 会允许 editorText 作为首次入场草稿', async () => {
    const { resolveSourceCardForPrepare } = await import('@/lib/challenge/entrant-draft');

    const draft: ChallengeEntrantDraftState = {
      entrantCards: [],
      sourceMode: null,
      rawEditorText: '{"codename":"初次入场"}',
      lastAppliedEditorText: '',
      isEditorDirty: false,
    };

    const result = await resolveSourceCardForPrepare(draft, async (text) => JSON.parse(text) as Record<string, unknown>);

    expect(result.sourceCard).toEqual({ codename: '初次入场' });
    expect(result.draft.entrantCards).toEqual([{ codename: '初次入场' }]);
  });

  test('dirty editorText 解析失败时，不会覆盖既有 entrantCards 和 sourceMode', async () => {
    const { createDraftFromImportedCard, markEditorTextChanged, resolveSourceCardForPrepare } = await import(
      '@/lib/challenge/entrant-draft'
    );

    const draft = markEditorTextChanged(
      createDraftFromImportedCard({ codename: '雾灯' }, 'database'),
      '{"codename":"夜纱"'
    );

    await expect(
      resolveSourceCardForPrepare(draft, async (text) => JSON.parse(text) as Record<string, unknown>)
    ).rejects.toThrow();

    expect(draft.entrantCards).toEqual([{ codename: '雾灯' }]);
    expect(draft.sourceMode).toBe('database');
  });
});
