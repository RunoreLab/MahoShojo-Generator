import {
  DataCardRefSchema,
  MAX_OPAQUE_KEY_LENGTH,
  MAX_PROPOSAL_CHANGES,
  OpaqueKeySchema,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';
import {
  DataCardReviewStatusSchema,
  ONLINE_DATA_CARD_TYPES,
  OnlineDataCardTypeSchema,
  type DataCardReviewStatus,
  type OnlineDataCardType,
} from '@mahoshojo/contracts/data-cards';

const MAX_REFS_PER_VERIFICATION = MAX_PROPOSAL_CHANGES;

type ArenaDataCardRefVerifierD1ReadOptions = {
  readonly retry: 'safe-read';
};

export type ArenaDataCardRefVerifierD1Result = {
  readonly success: boolean;
  readonly results: readonly Record<string, unknown>[];
};

export type ArenaDataCardRefVerifierD1Statement = {
  bind(...params: unknown[]): ArenaDataCardRefVerifierD1Statement;
  all(options: ArenaDataCardRefVerifierD1ReadOptions): Promise<ArenaDataCardRefVerifierD1Result>;
};

export type ArenaDataCardRefVerifierD1Client = {
  prepare(sql: string): ArenaDataCardRefVerifierD1Statement;
};

export type ArenaDataCardRefVerifierInput = {
  readonly refs: readonly DataCardRef[];
  readonly hostAccountUserId: number;
};

export type ArenaDataCardRefVerifierErrorCode =
  | 'ARENA_DATA_CARD_REF_D1_UNAVAILABLE'
  | 'ARENA_DATA_CARD_REF_D1_FAILED'
  | 'ARENA_DATA_CARD_REF_INPUT_INVALID'
  | 'ARENA_DATA_CARD_REF_METADATA_INVALID'
  | 'ARENA_DATA_CARD_REF_NOT_READABLE'
  | 'ARENA_DATA_CARD_REF_VERSION_MISMATCH';

export class ArenaDataCardRefVerifierError extends Error {
  constructor(readonly code: ArenaDataCardRefVerifierErrorCode) {
    super(code);
    this.name = 'ArenaDataCardRefVerifierError';
  }
}

export type ArenaDataCardRefVerifier = {
  verify(input: ArenaDataCardRefVerifierInput): Promise<readonly DataCardRef[]>;
};

export type ArenaDataCardRefVerifierOptions = {
  readonly getClient: () => ArenaDataCardRefVerifierD1Client | null;
};

type DataCardMetadata = {
  readonly id: string;
  readonly userId: number;
  readonly type: OnlineDataCardType;
  readonly isPublic: -1 | 0 | 1;
  readonly reviewStatus: DataCardReviewStatus;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
};

const METADATA_SELECT_SQL = `
SELECT
  id,
  user_id,
  type,
  is_public,
  review_status,
  updated_at,
  deleted_at
FROM data_cards
WHERE id = ?
LIMIT 1
`.trim();

const fail = (code: ArenaDataCardRefVerifierErrorCode): never => {
  throw new ArenaDataCardRefVerifierError(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
);

const positiveUserId = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value > 0
);

const canonicalString = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_OPAQUE_KEY_LENGTH
  && value.trim() === value
);

const parseCanonicalRef = (value: unknown): DataCardRef => {
  const parsed = DataCardRefSchema.safeParse(value);
  if (!parsed.success) return fail('ARENA_DATA_CARD_REF_INPUT_INVALID');
  if (!isRecord(value)) return fail('ARENA_DATA_CARD_REF_INPUT_INVALID');
  const parsedRef = parsed.data;
  const inputRef = value;

  // The shared schema trims opaque strings for ordinary wire parsing. This
  // adapter receives canonical refs and must not silently change the value
  // that is checked against the D1 version fence.
  if (inputRef.id !== parsedRef.id || inputRef.versionToken !== parsedRef.versionToken) {
    return fail('ARENA_DATA_CARD_REF_INPUT_INVALID');
  }

  return parsedRef;
};

const parseInput = (value: unknown): {
  readonly refs: readonly DataCardRef[];
  readonly hostAccountUserId: number;
} => {
  if (!isRecord(value)) {
    return fail('ARENA_DATA_CARD_REF_INPUT_INVALID');
  }
  const input = value;
  if (!Array.isArray(input.refs) || input.refs.length > MAX_REFS_PER_VERIFICATION) {
    return fail('ARENA_DATA_CARD_REF_INPUT_INVALID');
  }
  if (!positiveUserId(input.hostAccountUserId)) {
    return fail('ARENA_DATA_CARD_REF_INPUT_INVALID');
  }
  return {
    refs: input.refs.map(parseCanonicalRef),
    hostAccountUserId: input.hostAccountUserId,
  };
};

const parseVisibility = (value: unknown): -1 | 0 | 1 | null => {
  if (value === -1 || value === 0 || value === 1) return value;
  if (value === false) return 0;
  if (value === true) return 1;
  return null;
};

const parseMetadata = (row: unknown): DataCardMetadata => {
  if (!isRecord(row)) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');
  const metadataRow = row;

  const id = OpaqueKeySchema.safeParse(metadataRow.id);
  if (!id.success || id.data !== metadataRow.id) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');

  const type = OnlineDataCardTypeSchema.safeParse(metadataRow.type);
  if (!type.success) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');

  const reviewStatus = DataCardReviewStatusSchema.safeParse(metadataRow.review_status);
  if (!reviewStatus.success) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');

  const isPublic = parseVisibility(metadataRow.is_public);
  if (isPublic === null) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');

  if (!canonicalString(metadataRow.updated_at)) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');
  const updatedAt = metadataRow.updated_at;

  let deletedAt: string | null;
  if (metadataRow.deleted_at === null) {
    deletedAt = null;
  } else {
    if (!canonicalString(metadataRow.deleted_at)) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');
    deletedAt = metadataRow.deleted_at;
  }

  if (!positiveUserId(metadataRow.user_id)) return fail('ARENA_DATA_CARD_REF_METADATA_INVALID');

  return {
    id: id.data,
    userId: metadataRow.user_id,
    type: type.data,
    isPublic,
    reviewStatus: reviewStatus.data,
    updatedAt,
    deletedAt,
  };
};

const typeMatches = (ref: DataCardRef, metadata: DataCardMetadata): boolean => {
  if (ref.kind === 'material') {
    return ONLINE_DATA_CARD_TYPES.includes(metadata.type);
  }
  return metadata.type === ref.kind;
};

const isReadableByHost = (
  metadata: DataCardMetadata,
  hostAccountUserId: number,
): boolean => (
  metadata.deletedAt === null
  && metadata.reviewStatus === 'approved'
  && (
    metadata.isPublic === 1
    || (metadata.isPublic === 0 && metadata.userId === hostAccountUserId)
  )
);

const readMetadata = async (
  client: ArenaDataCardRefVerifierD1Client,
  ref: DataCardRef,
): Promise<DataCardMetadata> => {
  try {
    const result = await client
      .prepare(METADATA_SELECT_SQL)
      .bind(ref.id)
      .all({ retry: 'safe-read' });
    if (
      typeof result !== 'object'
      || result === null
      || result.success !== true
      || !Array.isArray(result.results)
    ) return fail('ARENA_DATA_CARD_REF_D1_FAILED');
    if (result.results.length !== 1) return fail('ARENA_DATA_CARD_REF_NOT_READABLE');
    return parseMetadata(result.results[0]);
  } catch (error) {
    if (error instanceof ArenaDataCardRefVerifierError) throw error;
    // Do not expose D1/SQL/transport error text to the caller. A read failure
    // is never permission success and never triggers a mutation/retry path.
    throw new ArenaDataCardRefVerifierError('ARENA_DATA_CARD_REF_D1_FAILED');
  }
};

const verifyOne = async (
  client: ArenaDataCardRefVerifierD1Client,
  ref: DataCardRef,
  hostAccountUserId: number,
): Promise<void> => {
  const metadata = await readMetadata(client, ref);
  if (
    metadata.id !== ref.id
    || !typeMatches(ref, metadata)
    || !isReadableByHost(metadata, hostAccountUserId)
  ) fail('ARENA_DATA_CARD_REF_NOT_READABLE');
  if (metadata.updatedAt !== ref.versionToken) {
    fail('ARENA_DATA_CARD_REF_VERSION_MISMATCH');
  }
};

export const createArenaDataCardRefVerifier = (
  options: ArenaDataCardRefVerifierOptions,
): ArenaDataCardRefVerifier => Object.freeze({
  async verify(input) {
    const parsed = parseInput(input);
    if (parsed.refs.length === 0) return Object.freeze([]);

    let client: ArenaDataCardRefVerifierD1Client | null = null;
    try {
      client = options.getClient();
    } catch {
      fail('ARENA_DATA_CARD_REF_D1_UNAVAILABLE');
    }
    if (client === null) return fail('ARENA_DATA_CARD_REF_D1_UNAVAILABLE');

    // Keep reads sequential and bounded. No partial result is returned if a
    // later ref is missing, stale, unauthorized, or has malformed metadata.
    for (const ref of parsed.refs) {
      await verifyOne(client, ref, parsed.hostAccountUserId);
    }
    return Object.freeze(parsed.refs.map((ref) => Object.freeze({ ...ref })));
  },
});
