import { afterEach, describe, expect, it } from 'vitest';
import { adminManagementFixture } from './admin-management-fixture';
import { readAdminAnalytics, readAdminAvailability } from '../src/admin/analytics';
import { ADMIN_ANALYTICS_ACTIONS } from '../src/admin/actions/analytics';

const close: (() => void)[] = [];
afterEach(() => close.splice(0).forEach((fn) => fn()));
const setup = async () => { const fixture = await adminManagementFixture(['analytics.write', 'ai-availability.write']); close.push(() => fixture.sqlite.close()); return fixture; };
const action = (name: string) => { const found = ADMIN_ANALYTICS_ACTIONS.find((item) => item.name === name); if (!found) throw new Error(`Missing ${name}`); return found; };

describe('Admin analytics and availability management', () => {
  it('reads empty aggregates as zero but reports missing schema as unavailable', async () => {
    const { db, sqlite } = await setup();
    expect((await readAdminAnalytics(db)).overview.total_users).toBe(0);
    sqlite.exec('DROP TABLE user_last_activity');
    await expect(readAdminAnalytics(db)).rejects.toThrow();
  });
  it('snapshot dry-run performs no writes and rejects over 30 missing-day requests', async () => {
    const { db, sqlite, context } = await setup();
    const before = sqlite.prepare('SELECT total_changes() AS n').get()?.n;
    const result = await action('analytics.snapshot').execute(db, { reason: '核对快照', idempotencyKey: 'preview', dryRun: true, backfillDays: 2 }, context);
    expect(result).toHaveProperty('dryRun', true);
    expect(sqlite.prepare('SELECT total_changes() AS n').get()?.n).toBe(before);
    await expect(action('analytics.snapshot').execute(db, { reason: '核对快照', idempotencyKey: 'preview', dryRun: true, backfillDays: 31 }, context)).rejects.toThrow();
  });
  it('only inserts missing snapshots, audits them and does not overwrite existing history on retry', async () => {
    const { db, sqlite, context } = await setup();
    const input = { reason: '补齐快照', idempotencyKey: 'snapshot', dryRun: false, backfillDays: 2, includeCurrent: false };
    await action('analytics.snapshot').execute(db, input, context);
    const before = sqlite.prepare('SELECT metric_date, updated_at FROM admin_user_analytics_daily ORDER BY metric_date').all();
    expect(before).toHaveLength(2);
    await action('analytics.snapshot').execute(db, input, context);
    expect(sqlite.prepare('SELECT metric_date, updated_at FROM admin_user_analytics_daily ORDER BY metric_date').all()).toEqual(before);
    expect(sqlite.prepare("SELECT count(*) AS n FROM admin_audit_events WHERE action='analytics.snapshot'").get()?.n).toBe(2);
    await expect(action('analytics.snapshot').execute(db, { ...input, backfillDays: 3 }, context)).rejects.toThrow('ADMIN_IDEMPOTENCY_CONFLICT');
    expect(sqlite.prepare('SELECT count(*) AS n FROM admin_user_analytics_daily').get()?.n).toBe(2);
  });
  it('keeps excluded samples out of rates and uses 24h only as reference when 1h lacks samples', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec("INSERT INTO ai_channel_availability_buckets VALUES ('2026-09-11T14:00:00.000Z','fixture','model',3,1,100,NULL,'2026-09-11T14:00:00.000Z')");
    const result = await readAdminAvailability(db, new Date('2026-09-12T12:00:00.000Z'));
    const channel = result.channels.find((row) => row.providerId === 'fixture');
    expect(channel?.primary.status).toBe('unknown');
    expect(channel?.reference?.successRate).toBe(0.75);
    expect(channel?.excluded24h).toBe(100);
  });
  it('refreshes a canonical public snapshot with idempotency and version conflict protection', async () => {
    const { db, sqlite, context } = await setup();
    const input = { reason: '刷新可用性', idempotencyKey: 'refresh' };
    expect(await action('ai-availability.refresh-snapshot').execute(db, input, context)).toHaveProperty('status', 'succeeded');
    expect(await action('ai-availability.refresh-snapshot').execute(db, input, context)).toHaveProperty('replayed', true);
    expect(await action('ai-availability.refresh-snapshot').execute(db, { ...input, idempotencyKey: 'stale' }, context)).toHaveProperty('status', 'conflict');
    const row = sqlite.prepare("SELECT payload_json FROM ai_channel_availability_snapshot WHERE id='default'").get();
    expect(JSON.parse(String(row?.payload_json))).toMatchObject({ success: true, minSampleCount: 3, windows: { '1h': { durationSeconds: 3600 } } });
  });
  it('binds cleanup to the exact preview and rolls back all rows when a bucket changed', async () => {
    const { db, sqlite, context } = await setup();
    sqlite.exec("INSERT INTO ai_channel_availability_buckets VALUES ('2020-01-01T00:00:00.000Z','fixture','one',1,0,0,NULL,'v1'),('2020-01-01T00:00:00.000Z','fixture','two',1,0,0,NULL,'v1')");
    const input = { reason: '过期清理', idempotencyKey: 'cleanup', cutoff: '2020-02-01T00:00:00.000Z', dryRun: true };
    const preview = await action('ai-availability.cleanup').execute(db, input, context) as { targets: string[][] };
    expect(preview.targets).toHaveLength(2);
    sqlite.exec("UPDATE ai_channel_availability_buckets SET updated_at='v2' WHERE model_id='two'");
    await expect(action('ai-availability.cleanup').execute(db, { ...input, dryRun: false, targets: preview.targets }, context)).rejects.toThrow();
    expect(sqlite.prepare('SELECT count(*) AS n FROM ai_channel_availability_buckets').get()?.n).toBe(2);
    const refreshed = await action('ai-availability.cleanup').execute(db, input, context) as { targets: string[][] };
    expect(await action('ai-availability.cleanup').execute(db, { ...input, dryRun: false, targets: refreshed.targets }, context)).toHaveProperty('status', 'succeeded');
    expect(sqlite.prepare('SELECT count(*) AS n FROM ai_channel_availability_buckets').get()?.n).toBe(0);
  });
  it('keeps non-empty user activity and frequency denominators consistent', async () => {
    const { db, sqlite } = await setup();
    sqlite.exec("INSERT INTO users(id,username,email,auth_key,created_at) VALUES(1,'user','private@example.com','secret','2026-08-01 00:00:00')");
    sqlite.exec("INSERT INTO user_last_activity VALUES(1,'2026-09-12T11:00:00.000Z','2026-09-12T11:00:00.000Z')");
    const result = await readAdminAnalytics(db, {}, new Date('2026-09-12T12:00:00.000Z'));
    expect(result.overview).toMatchObject({ total_users: 1, tracked_users: 1, active_users_24h: 1, activity_coverage_rate: 1 });
    expect(result.frequency.sample_users).toBe(1);
    expect(result.frequency.silent_users).toBe(1);
    expect(result.retentionSummary).toMatchObject({ total_users: 1, median_observed_retention_days: 42, p90_observed_retention_days: 42 });
    expect(result.retentionPoints.map((point) => point.days)).toEqual([1, 7, 30, 90]);
    expect(result.retentionPoints.find((point) => point.days === 30)).toMatchObject({ eligible: 1, retained: 1, rate: 1 });
    expect(JSON.stringify(result)).not.toMatch(/secret|private@example/);
  });
});
