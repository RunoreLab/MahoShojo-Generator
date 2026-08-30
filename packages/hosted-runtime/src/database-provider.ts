import type {
  D1LikeRow,
  D1LikeStatementResult,
} from './d1-http-client';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from './node-runtime/data-ports';

export type DatabaseConsistency = 'replica-ok' | 'primary';

export type DatabaseProviderId = 'hono-d1-primary' | 'cloudflare-d1-binding';

export type DatabaseSession = {
  client: NodeDataD1Client;
  consistency: DatabaseConsistency;
  initialBookmark: string | null;
  getBookmark(): string | null;
};

export type DatabaseProvider = {
  id: DatabaseProviderId;
  openSession(_input: {
    consistency: DatabaseConsistency;
    bookmark?: string | null;
  }): DatabaseSession | null;
};

export type CloudflareD1PreparedStatement = {
  bind(..._params: unknown[]): CloudflareD1PreparedStatement;
  run(): Promise<unknown>;
  all(): Promise<unknown>;
};

export type CloudflareD1Session = {
  prepare(_sql: string): CloudflareD1PreparedStatement;
  getBookmark(): string | null;
};

export type CloudflareD1Binding = {
  withSession(_constraint: string): CloudflareD1Session;
};

const nonEmptyBookmark = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized || null;
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isCloudflareStatement = (value: unknown): value is CloudflareD1PreparedStatement => (
  isObject(value)
  && typeof value.bind === 'function'
  && typeof value.run === 'function'
  && typeof value.all === 'function'
);

const isCloudflareSession = (value: unknown): value is CloudflareD1Session => (
  isObject(value)
  && typeof value.prepare === 'function'
  && typeof value.getBookmark === 'function'
);

const isCloudflareBinding = (value: unknown): value is CloudflareD1Binding => (
  isObject(value) && typeof value.withSession === 'function'
);

const asRows = (value: unknown): D1LikeRow[] => (
  Array.isArray(value)
    ? value.filter(isObject)
    : []
);

const normalizeD1Result = (value: unknown): D1LikeStatementResult => {
  const record = isObject(value) ? value : {};
  const error = typeof record.error === 'string' ? record.error : undefined;
  return {
    success: record.success === true,
    results: asRows(record.results),
    meta: isObject(record.meta) ? record.meta : {},
    ...(error ? { error } : {}),
  };
};

const adaptCloudflareStatement = (
  initialStatement: CloudflareD1PreparedStatement,
): NodeDataD1Statement => {
  let statement = initialStatement;
  const adapter: NodeDataD1Statement = {
    bind: (...params) => {
      const bound = statement.bind(...params);
      if (!isCloudflareStatement(bound)) {
        throw new Error('Cloudflare D1 statement binding unavailable');
      }
      statement = bound;
      return adapter;
    },
    // D1 binding owns transport retry semantics. Node HTTP retry hints must not
    // be forwarded or implemented as a second request here.
    run: async () => normalizeD1Result(await statement.run()),
    all: async () => normalizeD1Result(await statement.all()),
  };
  return adapter;
};

const adaptCloudflareSession = (session: CloudflareD1Session): NodeDataD1Client => ({
  prepare: (sql) => {
    const statement = session.prepare(sql);
    if (!isCloudflareStatement(statement)) {
      throw new Error('Cloudflare D1 statement unavailable');
    }
    return adaptCloudflareStatement(statement);
  },
});

export const createHonoPrimaryDatabaseProvider = (
  getClient: () => NodeDataD1Client | null,
): DatabaseProvider => ({
  id: 'hono-d1-primary',
  openSession: ({ consistency, bookmark }) => {
    try {
      const client = getClient();
      if (!client) return null;
      const initialBookmark = nonEmptyBookmark(bookmark);
      return Object.freeze({
        client,
        consistency,
        initialBookmark,
        // The HTTP primary transport cannot mint D1 Session bookmarks. Keeping
        // the caller's lineage is stronger than fabricating an unsupported one.
        getBookmark: () => initialBookmark,
      });
    } catch {
      return null;
    }
  },
});

export const createCloudflareD1BindingDatabaseProvider = (
  getBinding: () => unknown,
): DatabaseProvider => ({
  id: 'cloudflare-d1-binding',
  openSession: ({ consistency, bookmark }) => {
    try {
      const binding = getBinding();
      if (!isCloudflareBinding(binding)) return null;
      const initialBookmark = nonEmptyBookmark(bookmark);
      const constraint = initialBookmark
        ?? (consistency === 'primary' ? 'first-primary' : 'first-unconstrained');
      const session = binding.withSession(constraint);
      if (!isCloudflareSession(session)) return null;
      return Object.freeze({
        client: adaptCloudflareSession(session),
        consistency,
        initialBookmark,
        getBookmark: () => nonEmptyBookmark(session.getBookmark()),
      });
    } catch {
      return null;
    }
  },
});
