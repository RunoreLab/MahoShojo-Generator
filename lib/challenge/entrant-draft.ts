import { type ChallengeEntrantSourceMode, stringifyCharacterCardForEditor } from '@/lib/challenge/entrant-import';

export type ChallengeEntrantDraftState = {
  entrantCards: Record<string, unknown>[];
  sourceMode: ChallengeEntrantSourceMode | null;
  rawEditorText: string;
  lastAppliedEditorText: string;
  isEditorDirty: boolean;
};

export function createDraftFromImportedCard(
  card: Record<string, unknown>,
  sourceMode: Exclude<ChallengeEntrantSourceMode, 'manual-json'>
): ChallengeEntrantDraftState {
  const editorText = stringifyCharacterCardForEditor(card);

  return {
    entrantCards: [card],
    sourceMode,
    rawEditorText: editorText,
    lastAppliedEditorText: editorText,
    isEditorDirty: false,
  };
}

export function markEditorTextChanged(
  draft: ChallengeEntrantDraftState,
  rawEditorText: string
): ChallengeEntrantDraftState {
  return {
    ...draft,
    rawEditorText,
    isEditorDirty: rawEditorText !== draft.lastAppliedEditorText,
  };
}

export async function applyEditorTextToDraft(
  draft: ChallengeEntrantDraftState,
  parseCard: (text: string) => Promise<Record<string, unknown>>
): Promise<ChallengeEntrantDraftState> {
  const card = await parseCard(draft.rawEditorText);

  return {
    entrantCards: [card],
    sourceMode: 'manual-json',
    rawEditorText: draft.rawEditorText,
    lastAppliedEditorText: draft.rawEditorText,
    isEditorDirty: false,
  };
}

export async function resolveSourceCardForPrepare(
  draft: ChallengeEntrantDraftState,
  parseCard: (text: string) => Promise<Record<string, unknown>>
): Promise<{
  draft: ChallengeEntrantDraftState;
  sourceCard: Record<string, unknown>;
}> {
  if (draft.isEditorDirty) {
    const nextDraft = await applyEditorTextToDraft(draft, parseCard);
    return {
      draft: nextDraft,
      sourceCard: nextDraft.entrantCards[0] as Record<string, unknown>,
    };
  }

  const currentCard = draft.entrantCards[0];
  if (currentCard) {
    return {
      draft,
      sourceCard: currentCard,
    };
  }

  const nextDraft = await applyEditorTextToDraft(
    {
      ...draft,
      isEditorDirty: true,
    },
    parseCard
  );

  return {
    draft: nextDraft,
    sourceCard: nextDraft.entrantCards[0] as Record<string, unknown>,
  };
}
