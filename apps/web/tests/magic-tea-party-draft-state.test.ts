import {
  createMagicTeaPartyDraftState,
  editMagicTeaPartyDraftState,
  hydrateMagicTeaPartyDraftFromSession,
} from '@/lib/magic-tea-party/draft-state';
import { readMagicTeaPartyDraft, writeMagicTeaPartyDraft } from '@/lib/magic-tea-party/drafts';

describe('magic tea party draft state', () => {
  it('does not replace an edited draft when the matching session finishes loading', () => {
    const initial = createMagicTeaPartyDraftState('session-a', null);
    const edited = editMagicTeaPartyDraftState(initial, 'session-a', '正在快速输入');

    expect(
      hydrateMagicTeaPartyDraftFromSession(edited, {
        id: 'session-a',
        draft: '较旧的数据库草稿',
      })
    ).toBe(edited);
  });

  it('ignores a stale session while switching and hydrates only the matching session once', () => {
    const switched = createMagicTeaPartyDraftState('session-b', null);

    expect(
      hydrateMagicTeaPartyDraftFromSession(switched, {
        id: 'session-a',
        draft: '会话 A 草稿',
      })
    ).toBe(switched);

    const hydrated = hydrateMagicTeaPartyDraftFromSession(switched, {
      id: 'session-b',
      draft: '会话 B 草稿',
    });
    expect(hydrated).toMatchObject({ sessionId: 'session-b', value: '会话 B 草稿', canHydrateFromSession: false });

    expect(
      hydrateMagicTeaPartyDraftFromSession(hydrated, {
        id: 'session-b',
        draft: '迟到的旧值',
      })
    ).toBe(hydrated);
  });

  it('treats an explicitly cleared browser draft as newer than the database draft', () => {
    const cleared = createMagicTeaPartyDraftState('session-a', '');

    expect(
      hydrateMagicTeaPartyDraftFromSession(cleared, {
        id: 'session-a',
        draft: '不应复活的旧草稿',
      })
    ).toBe(cleared);
    expect(cleared.value).toBe('');
  });
});

describe('magic tea party draft storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves an explicitly cleared draft', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    writeMagicTeaPartyDraft('session-a', '');

    expect(readMagicTeaPartyDraft('session-a')).toBe('');
  });
});
