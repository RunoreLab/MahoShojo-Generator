import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDrizzleDb } from '@mahoshojo/hosted-runtime/db/drizzle';
import { finalizeAssignment, updateRound } from '@/lib/db/repositories/crowd-review';
import { applyCrowdReviewRoundResultToReportCase } from '@/lib/crowd-review/service';

type SQLite = { close(): void; exec(_sql: string): void; prepare(_sql: string): { all(..._args: unknown[]): Record<string, unknown>[]; run(..._args: unknown[]): { changes: number } } };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (_path: string) => SQLite };
const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));
const setup = () => {
  const sqlite = new DatabaseSync(':memory:');
  closers.push(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../lib/database/schema.sql', import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO users(id,username,email,auth_key) VALUES (1,'one','one@example.test','one')");
  sqlite.exec("INSERT INTO data_cards(id,user_id,type,name,data) VALUES ('card',1,'character','卡片','{}')");
  sqlite.exec("INSERT INTO report_cases(id,target_entity_type,target_entity_id,target_user_id,status,latest_reported_at) VALUES ('case','data_card','card',1,'under_review','2026-01-01')");
  sqlite.exec("INSERT INTO crowd_review_rounds(id,report_case_id,status,opened_at,deadline_at,min_valid_votes,updated_at) VALUES ('round','case','active','2026-01-01','2027-01-01',3,'old')");
  sqlite.exec("INSERT INTO crowd_review_assignments(id,crowd_review_round_id,inspector_user_id,status,assigned_at,expires_at) VALUES ('assignment','round',1,'assigned','2026-01-01','2027-01-01')");
  const native = {
    exec(sql: string) { sqlite.exec(sql); },
    async batch() { throw new Error('batch not used by these repository tests'); },
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
        async raw() { return sqlite.prepare(sql).all(...args).map((row) => Object.values(row)); },
        async run() { return { success: true, results: [], meta: sqlite.prepare(sql).run(...args) }; },
      };
      return statement;
    },
  };
  return { sqlite, db: createDrizzleDb(native) };
};

describe('Web crowd review respects manual administration', () => {
  it('uses a real SQL round fence against stale summaries, concluded rounds and admin takeover', async () => {
    const { db, sqlite } = setup();
    const input = { roundId: 'round', expectedUpdatedAt: 'old', status: 'concluded', resultCode: 'violation', now: 'new' };
    expect(await updateRound(db, { ...input, expectedUpdatedAt: 'stale' })).toBe(false);
    sqlite.exec("UPDATE crowd_review_rounds SET status='escalated',result_summary_json='{\"adminAction\":{\"action\":\"take-over\"}}'");
    expect(await updateRound(db, input)).toBe(false);
    sqlite.exec("UPDATE crowd_review_rounds SET status='active',result_summary_json='{}'");
    expect(await updateRound(db, input)).toBe(true);
    expect(await updateRound(db, { ...input, expectedUpdatedAt: 'new' })).toBe(false);
  });

  it('refuses late votes after an inspector is revoked or a round is manually controlled', async () => {
    const { db, sqlite } = setup();
    const input = { assignmentId: 'assignment', userId: 1, status: 'voted' as const, decision: 'violation' as const, note: null, postVoteSummaryJson: '{}', now: 'new' };
    sqlite.exec("INSERT INTO crowd_review_inspectors(user_id,status) VALUES (1,'revoked')");
    expect(await finalizeAssignment(db, input)).toBe(false);
    sqlite.exec("UPDATE crowd_review_inspectors SET status='active'");
    sqlite.exec("UPDATE crowd_review_rounds SET result_summary_json='{\"adminAction\":{\"action\":\"take-over\"}}'");
    expect(await finalizeAssignment(db, input)).toBe(false);
    sqlite.exec("UPDATE crowd_review_rounds SET result_summary_json='{}'");
    expect(await finalizeAssignment(db, input)).toBe(true);
  });

  it('does not send a resolution notification after a failed case fence', async () => {
    let notifications = 0;
    expect(await applyCrowdReviewRoundResultToReportCase({ db: {} as never, reportCaseId: 'case', roundId: 'round',
      roundResult: 'violation', now: 'new', updateReportCaseResolution: async () => false,
      notifyReportCaseResolutionIfNeeded: async () => { notifications++; return true; } })).toBe(false);
    expect(notifications).toBe(0);
  });
});
