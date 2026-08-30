import {
  ArenaProposalIdSchema,
  OpaqueKeySchema,
  RoomRevisionSchema,
  type ArenaProposalChange,
  type ArenaRoomProposalSubmitRequest,
  type ArenaRoomSharedConfig,
  type ArenaRoomSnapshot,
} from '@mahoshojo/contracts/arena-room';
import {
  applyArenaRoomSharedConfig,
  diffArenaSharedConfig,
  validateProposalChanges,
  type ProposalSelectionIssue,
  type ProposalSelectionValidation,
} from '@mahoshojo/multiplayer-core';

export type ArenaProposalEditorSnapshot = Pick<
  ArenaRoomSnapshot,
  'roomId' | 'roomEpoch' | 'revision' | 'sharedConfig'
>;

export type ArenaProposalEditorState = {
  readonly roomId: string;
  readonly baselineEpoch: string;
  readonly baselineRevision: number;
  readonly baselineConfig: ArenaRoomSharedConfig;
  readonly workingConfig: ArenaRoomSharedConfig;
  readonly dirty: boolean;
  readonly stale: boolean;
  readonly replacementRequired: boolean;
};

export type ArenaProposalPreview = {
  readonly changes: readonly ArenaProposalChange[];
  readonly selectedChangeIds: readonly string[];
};

/**
 * The only mutation body that the Web editor may construct. The server adds
 * author, status, timestamp, and room identity from its authenticated context.
 */
export type ArenaProposalSubmitIntent = ArenaRoomProposalSubmitRequest;

export type ArenaProposalEditorErrorCode =
  | 'invalid-snapshot'
  | 'invalid-working-config'
  | 'invalid-proposal-id'
  | 'empty-proposal'
  | 'unsupported-change'
  | 'selection-invalid'
  | 'replacement-required'
  | 'revision-inconsistent';

export class ArenaProposalEditorError extends Error {
  public readonly code: ArenaProposalEditorErrorCode;

  public readonly issues: readonly ProposalSelectionIssue[] | undefined;

  public constructor(
    code: ArenaProposalEditorErrorCode,
    message: string,
    options: { readonly issues?: readonly ProposalSelectionIssue[] } = {},
  ) {
    super(message);
    this.name = 'ArenaProposalEditorError';
    this.code = code;
    this.issues = options.issues;
  }
}

type NormalizedSnapshot = {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly revision: number;
  readonly sharedConfig: ArenaRoomSharedConfig;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sameConfig = (
  left: ArenaRoomSharedConfig,
  right: ArenaRoomSharedConfig,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const invalidSnapshot = (message: string): ArenaProposalEditorError => (
  new ArenaProposalEditorError('invalid-snapshot', message)
);

const normalizeSnapshot = (input: unknown): NormalizedSnapshot => {
  if (!isRecord(input)) throw invalidSnapshot('projected room snapshot must be an object');

  const roomId = OpaqueKeySchema.safeParse(input.roomId);
  const roomEpoch = OpaqueKeySchema.safeParse(input.roomEpoch);
  const revision = RoomRevisionSchema.safeParse(input.revision);
  if (!roomId.success || !roomEpoch.success || !revision.success) {
    throw invalidSnapshot('projected room snapshot has invalid room identity or revision');
  }

  try {
    return {
      roomId: roomId.data,
      roomEpoch: roomEpoch.data,
      revision: revision.data,
      sharedConfig: applyArenaRoomSharedConfig(input.sharedConfig),
    };
  } catch {
    throw new ArenaProposalEditorError(
      'invalid-snapshot',
      'projected room snapshot does not contain a valid safe shared config',
    );
  }
};

const createState = (snapshot: NormalizedSnapshot): ArenaProposalEditorState => {
  const baselineConfig = applyArenaRoomSharedConfig(snapshot.sharedConfig);
  return {
    roomId: snapshot.roomId,
    baselineEpoch: snapshot.roomEpoch,
    baselineRevision: snapshot.revision,
    baselineConfig,
    workingConfig: applyArenaRoomSharedConfig(baselineConfig),
    dirty: false,
    stale: false,
    replacementRequired: false,
  };
};

const workingConfigOrError = (input: unknown): ArenaRoomSharedConfig => {
  try {
    return applyArenaRoomSharedConfig(input);
  } catch {
    throw new ArenaProposalEditorError(
      'invalid-working-config',
      'working copy must be a valid safe shared config',
    );
  }
};

export const createArenaProposalEditor = (
  snapshot: ArenaProposalEditorSnapshot,
): ArenaProposalEditorState => createState(normalizeSnapshot(snapshot));

export const replaceWorkingConfig = (
  editor: ArenaProposalEditorState,
  workingConfig: unknown,
): ArenaProposalEditorState => {
  const nextWorkingConfig = workingConfigOrError(workingConfig);
  return {
    ...editor,
    workingConfig: nextWorkingConfig,
    dirty: !sameConfig(editor.baselineConfig, nextWorkingConfig),
  };
};

export const editWorkingConfig = (
  editor: ArenaProposalEditorState,
  update: (draft: ArenaRoomSharedConfig) => ArenaRoomSharedConfig,
): ArenaProposalEditorState => {
  const draft = applyArenaRoomSharedConfig(editor.workingConfig);
  return replaceWorkingConfig(editor, update(draft));
};

/**
 * Applies a server snapshot without discarding a dirty draft. A clean draft
 * follows a newer revision automatically; an epoch change always requires an
 * explicit reset so an old intent can never be sent to a new room incarnation.
 */
export const syncArenaProposalEditor = (
  editor: ArenaProposalEditorState,
  snapshot: ArenaProposalEditorSnapshot,
): ArenaProposalEditorState => {
  const incoming = normalizeSnapshot(snapshot);

  if (incoming.roomId !== editor.roomId || incoming.roomEpoch !== editor.baselineEpoch) {
    return {
      ...editor,
      stale: true,
      replacementRequired: true,
    };
  }

  if (incoming.revision < editor.baselineRevision) return editor;
  if (incoming.revision === editor.baselineRevision) {
    if (!sameConfig(incoming.sharedConfig, editor.baselineConfig)) {
      throw new ArenaProposalEditorError(
        'revision-inconsistent',
        'same room revision cannot carry a different shared config',
      );
    }
    return editor;
  }

  if (editor.dirty || editor.replacementRequired) {
    return { ...editor, stale: true };
  }
  return createState(incoming);
};

export const resetArenaProposalEditor = (
  snapshot: ArenaProposalEditorSnapshot,
): ArenaProposalEditorState => createState(normalizeSnapshot(snapshot));

const unsupportedCoreError = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  return error.code === 'unsupported-change' || error.code === 'array-reorder';
};

export const assertArenaProposalSelection = (
  changes: readonly ArenaProposalChange[],
  selectedChangeIds?: readonly string[],
): ProposalSelectionValidation => {
  const validation = validateProposalChanges(changes, selectedChangeIds);
  if (!validation.valid) {
    throw new ArenaProposalEditorError(
      'selection-invalid',
      validation.issues.map((issue) => issue.message).join('; ') || 'proposal selection is invalid',
      { issues: validation.issues },
    );
  }
  return {
    ...validation,
    changes: cloneJson(validation.changes),
    selectedChangeIds: [...validation.selectedChangeIds],
    issues: [],
  };
};

export const previewArenaProposal = (
  editor: ArenaProposalEditorState,
  selectedChangeIds?: readonly string[],
): ArenaProposalPreview => {
  if (editor.replacementRequired) {
    throw new ArenaProposalEditorError(
      'replacement-required',
      'room epoch changed; resync before creating a proposal',
    );
  }

  let changes: ArenaProposalChange[];
  try {
    changes = diffArenaSharedConfig(editor.baselineConfig, editor.workingConfig);
  } catch (error) {
    if (unsupportedCoreError(error)) {
      throw new ArenaProposalEditorError(
        'unsupported-change',
        error instanceof Error ? error.message : 'working copy contains an unsupported change',
      );
    }
    throw new ArenaProposalEditorError(
      'invalid-working-config',
      error instanceof Error ? error.message : 'working copy could not be diffed',
    );
  }

  if (changes.length === 0) {
    throw new ArenaProposalEditorError('empty-proposal', 'working copy has no changes to submit');
  }

  const selection = assertArenaProposalSelection(changes, selectedChangeIds);
  return {
    changes: cloneJson(selection.changes),
    selectedChangeIds: [...selection.selectedChangeIds],
  };
};

export const buildArenaProposalSubmitIntent = (
  editor: ArenaProposalEditorState,
  proposalId: string,
  selectedChangeIds?: readonly string[],
): ArenaProposalSubmitIntent => {
  if (editor.replacementRequired) {
    throw new ArenaProposalEditorError(
      'replacement-required',
      'room epoch changed; resync before submitting a proposal',
    );
  }

  const parsedProposalId = ArenaProposalIdSchema.safeParse(proposalId);
  if (!parsedProposalId.success || parsedProposalId.data !== proposalId) {
    throw new ArenaProposalEditorError('invalid-proposal-id', 'proposalId must be a non-empty opaque key');
  }

  const preview = previewArenaProposal(editor, selectedChangeIds);
  const selected = new Set(preview.selectedChangeIds);
  return {
    proposalId: parsedProposalId.data,
    expectedRoomEpoch: editor.baselineEpoch,
    baseRevision: editor.baselineRevision,
    changes: cloneJson(preview.changes.filter((change) => selected.has(change.changeId))),
  };
};
