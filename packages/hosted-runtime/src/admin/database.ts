/** Request-scoped native D1 binding. No HTTP credentials or environment lookup. */
export interface AdminQueryResult<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta?: { changes?: number };
  error?: string;
}

export interface AdminPreparedStatement {
  bind(..._values: unknown[]): AdminPreparedStatement;
  all<T = Record<string, unknown>>(): Promise<AdminQueryResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<AdminQueryResult>;
}

export interface AdminDatabase {
  prepare(_sql: string): AdminPreparedStatement;
  /** Native D1 batch: sequential statements, with the entire batch rolled back on error. */
  batch(_statements: AdminPreparedStatement[]): Promise<AdminQueryResult[]>;
}

export const assertAdminBatchSucceeded = (results: AdminQueryResult[]): void => {
  if (results.some((result) => !result.success)) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
};
