import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDrizzleDb } from '@mahoshojo/hosted-runtime/db/drizzle';
import type { AutoReviewEngine, AutoReviewPolicy, ReviewOutcome, ReviewTarget } from '@mahoshojo/hosted-runtime/auto-review';
import {
  autoReviewLatestPendingPublicDataCardsForUser,
  autoReviewLatestPendingPublicDataCardUpdatesForUser,
} from '@/lib/review/auto-data-card-review';

type SQLite = {
  close(): void;
  exec(_sql: string): void;
  prepare(_sql: string): {
    all(..._args: unknown[]): Record<string, unknown>[];
    get(..._args: unknown[]): Record<string, unknown> | undefined;
    run(..._args: unknown[]): { changes: number };
  };
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (_path: string) => SQLite };

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

const setup = () => {
  const sqlite = new DatabaseSync(':memory:');
  closers.push(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../lib/database/schema.sql', import.meta.url), 'utf8'));
  // schema.sql 之后的迁移新增列：与 drizzle 映射保持一致。
  sqlite.exec("ALTER TABLE user_messages ADD COLUMN created_by_admin_principal_id TEXT");
  sqlite.exec(
    "INSERT INTO users(id,username,email,auth_key,is_review_exempt) VALUES " +
      "(1,'u1','u1@example.test','k1',0)," +
      "(2,'u2','u2@example.test','k2',1)",
  );
  const native = {
    exec(sql: string) { sqlite.exec(sql); },
    async batch() { throw new Error('batch not used by these tests'); },
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

const seedCard = (sqlite: SQLite, id: string, userId: number, reviewStatus = 'pending', isPublic = 1) =>
  sqlite.exec(
    `INSERT INTO data_cards(id,user_id,type,name,description,data,is_public,review_status,created_at,updated_at)
     VALUES ('${id}',${userId},'scenario','卡${id}','简介','{"text":"内容"}',${isPublic},'${reviewStatus}','2026-01-01','2026-01-01')`,
  );

const seedUpdate = (
  sqlite: SQLite,
  updateId: string,
  cardId: string,
  userId: number,
  name: string,
  data: string,
) =>
  sqlite.exec(
    `INSERT INTO data_card_updates(id,data_card_id,user_id,name,data,updated_at)
     VALUES ('${updateId}','${cardId}',${userId},'${name}','${data}','2026-01-02')`,
  );

const cleanCoverage = { truncated: false, parseError: false };

const stubEngine = (
  outcomes: Record<string, ReviewOutcome>,
  onReview?: (t: ReviewTarget) => void,
): AutoReviewEngine => ({
  backends: [],
  review: async (t: ReviewTarget) => {
    onReview?.(t);
    const outcome = outcomes[t.id];
    if (!outcome) throw new Error('no outcome');
    return {
      outcome,
      backendId: 'stub',
      kind: 'llm',
      latencyMs: 1,
      attempted: ['stub'],
      inputCoverage: outcome.inputCoverage ?? cleanCoverage,
    };
  },
});

const basePolicy: AutoReviewPolicy = { onUncertain: 'normal', exemptUserPolicy: 'skip', notifyOnAutoReject: true };

describe('auto-data-card-review（引擎通路）', () => {
  it('approve → review_status 置 approved + 审计行 applied=1', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-a', 1);
    const r = await autoReviewLatestPendingPublicDataCardsForUser(1, {
      db: db as never,
      engine: stubEngine({ 'card-a': { verdict: 'approve', score: 0.05 } }),
      policy: basePolicy,
    });
    expect(r.approvedCount).toBe(1);
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-a'").get()!.v).toBe('approved');
    const audit = sqlite.prepare("SELECT * FROM auto_review_decisions WHERE data_card_id='card-a'").all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      target_kind: 'card',
      verdict: 'approve',
      action: 'approve',
      applied: 1,
      backend_id: 'stub',
      backend_kind: 'llm',
    });
    expect(String(audit[0].content_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reject → review_status 置 rejected + 发送 moderation 系统消息', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-r', 1);
    const r = await autoReviewLatestPendingPublicDataCardsForUser(1, {
      db: db as never,
      engine: stubEngine({
        'card-r': { verdict: 'reject', score: 0.9, category: 'sexual', reason: '自动安全审查检测到疑似违规内容（性内容）。' },
      }),
      policy: basePolicy,
    });
    expect(r.rejectedCount).toBe(1);
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-r'").get()!.v).toBe('rejected');
    const msgs = sqlite.prepare("SELECT * FROM user_messages WHERE recipient_user_id=1").all();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: 'system',
      message_type: 'moderation',
      template_key: 'user.moderation.data_card_rejected',
      source_entity_type: 'data_card',
      source_entity_id: 'card-r',
      priority: 'high',
    });
    expect(JSON.parse(String(msgs[0].payload_json)).autoReview).toBe(true);
  });

  it('reject 后重跑不再处理、不重复发消息', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-r2', 1);
    const deps = {
      db: db as never,
      engine: stubEngine({ 'card-r2': { verdict: 'reject', score: 0.9, category: 'gore' } }),
      policy: basePolicy,
    };
    await autoReviewLatestPendingPublicDataCardsForUser(1, deps);
    const second = await autoReviewLatestPendingPublicDataCardsForUser(1, deps);
    expect(second.reviewedCount).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) c FROM user_messages').get()!.c).toBe(1);
  });

  it('uncertain + normal：普通用户留 pending', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-u', 1);
    const r = await autoReviewLatestPendingPublicDataCardsForUser(1, {
      db: db as never,
      engine: stubEngine({ 'card-u': { verdict: 'uncertain', score: 0.4 } }),
      policy: basePolicy,
    });
    expect(r.heldCount).toBe(1);
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-u'").get()!.v).toBe('pending');
  });

  it('uncertain + reject 策略 → rejected；uncertain + approve 策略 → approved', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-ur', 1);
    seedCard(sqlite, 'card-ua', 1);
    await autoReviewLatestPendingPublicDataCardsForUser(1, {
      db: db as never,
      engine: stubEngine({
        'card-ur': { verdict: 'uncertain', score: 0.4, reason: 'auto-review unavailable' },
        'card-ua': { verdict: 'uncertain', score: 0.4 },
      }),
      policy: { ...basePolicy, onUncertain: 'reject' },
    });
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-ur'").get()!.v).toBe('rejected');
    // 同一策略下两卡同归 rejected
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-ua'").get()!.v).toBe('rejected');
  });

  it('uncertain + normal：豁免用户 approve', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-e', 2);
    const r = await autoReviewLatestPendingPublicDataCardsForUser(2, {
      db: db as never,
      engine: stubEngine({ 'card-e': { verdict: 'uncertain', score: 0.4 } }),
      policy: { ...basePolicy, exemptUserPolicy: 'review' },
    });
    expect(r.approvedCount).toBe(1);
  });

  it('exemptUserPolicy=skip：豁免用户直接跳过审查', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-s', 2);
    const r = await autoReviewLatestPendingPublicDataCardsForUser(2, {
      db: db as never,
      engine: stubEngine({ 'card-s': { verdict: 'reject', score: 1 } }),
      policy: basePolicy,
    });
    expect(r.reason).toBe('exempt-skip');
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-s'").get()!.v).toBe('pending');
  });

  it('无引擎：留 pending、不跑任何审查、无审计行', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-ne', 1);
    const r = await autoReviewLatestPendingPublicDataCardsForUser(1, {
      db: db as never,
      engine: null,
      policy: basePolicy,
    });
    expect(r.reason).toBe('engine-unavailable');
    expect(r.reviewedCount).toBe(0);
    expect(r.heldCount).toBe(1);
    expect(sqlite.prepare("SELECT review_status v FROM data_cards WHERE id='card-ne'").get()!.v).toBe('pending');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM auto_review_decisions').get()!.c).toBe(0);
  });

  it('版本竞态：审核期间卡内容被改 → 守卫未命中、卡保持 pending、审计 applied=0', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-race', 1);
    const engine = stubEngine(
      { 'card-race': { verdict: 'approve', score: 0.01 } },
      () => {
        // 模拟模型推理期间用户改了卡内容（含 updated_at）
        sqlite.exec(
          "UPDATE data_cards SET name='改名', data='{\"text\":\"新内容\"}', updated_at='2026-01-03' WHERE id='card-race'",
        );
      },
    );
    const r = await autoReviewLatestPendingPublicDataCardsForUser(1, { db: db as never, engine, policy: basePolicy });
    expect(r.approvedCount).toBe(0);
    expect(r.heldCount).toBe(1);
    const row = sqlite.prepare("SELECT review_status v, name FROM data_cards WHERE id='card-race'").get()!;
    expect(row.v).toBe('pending');
    expect(row.name).toBe('改名');
    const audit = sqlite.prepare("SELECT * FROM auto_review_decisions WHERE data_card_id='card-race'").all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'approve', applied: 0 });
  });

  it('待审更新 reject：丢弃更新行 + 通知，线上版本不变', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-up', 1, 'approved', 1);
    seedUpdate(sqlite, 'upd-1', 'card-up', 1, '新名', '{"text":"违规"}');
    const r = await autoReviewLatestPendingPublicDataCardUpdatesForUser(1, {
      db: db as never,
      engine: stubEngine({ 'card-up': { verdict: 'reject', score: 0.95, category: 'hate', reason: '仇恨' } }),
      policy: basePolicy,
    });
    expect(r.rejectedCount).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) c FROM data_card_updates").get()!.c).toBe(0);
    expect(sqlite.prepare("SELECT name v FROM data_cards WHERE id='card-up'").get()!.v).toBe('卡card-up');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM user_messages').get()!.c).toBe(1);
  });

  it('U1 审核中被 U2 顶替：reject 不误删 U2、线上版本不变、不发通知', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-u2', 1, 'approved', 1);
    seedUpdate(sqlite, 'upd-1', 'card-u2', 1, 'U1名', '{"text":"U1违规"}');
    const engine = stubEngine(
      { 'card-u2': { verdict: 'reject', score: 0.9, category: 'hate' } },
      () => {
        // 审核途中用户重新提交：同 id 行被 U2 内容覆盖（upsert 复用行）
        sqlite.exec("UPDATE data_card_updates SET name='U2名', data='{\"text\":\"U2合规\"}' WHERE id='upd-1'");
      },
    );
    const r = await autoReviewLatestPendingPublicDataCardUpdatesForUser(1, { db: db as never, engine, policy: basePolicy });
    expect(r.rejectedCount).toBe(0);
    expect(r.heldCount).toBe(1);
    const upd = sqlite.prepare("SELECT * FROM data_card_updates WHERE id='upd-1'").get()!;
    expect(upd.name).toBe('U2名');
    expect(sqlite.prepare("SELECT name v FROM data_cards WHERE id='card-u2'").get()!.v).toBe('卡card-u2');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM user_messages').get()!.c).toBe(0);
    const audit = sqlite.prepare("SELECT * FROM auto_review_decisions WHERE data_card_id='card-u2'").all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ target_kind: 'update', update_id: 'upd-1', action: 'reject', applied: 0 });
  });

  it('更新 approve：快照命中时落基 + 删待审行 + 审计记录', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-ok', 1, 'approved', 1);
    seedUpdate(sqlite, 'upd-ok', 'card-ok', 1, '合规新名', '{"text":"合规"}');
    const r = await autoReviewLatestPendingPublicDataCardUpdatesForUser(1, {
      db: db as never,
      engine: stubEngine({ 'card-ok': { verdict: 'approve', score: 0.02 } }),
      policy: basePolicy,
    });
    expect(r.approvedCount).toBe(1);
    const card = sqlite.prepare("SELECT name, data FROM data_cards WHERE id='card-ok'").get()!;
    expect(card.name).toBe('合规新名');
    expect(card.data).toBe('{"text":"合规"}');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM data_card_updates').get()!.c).toBe(0);
    const audit = sqlite.prepare("SELECT * FROM auto_review_decisions WHERE data_card_id='card-ok'").all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ verdict: 'approve', action: 'approve', applied: 1 });
  });

  it('更新 approve 但卡片被改：守卫未命中、更新行保留待复审', async () => {
    const { sqlite, db } = setup();
    seedCard(sqlite, 'card-cw', 1, 'approved', 1);
    seedUpdate(sqlite, 'upd-cw', 'card-cw', 1, '新名', '{"text":"新内容"}');
    const engine = stubEngine(
      { 'card-cw': { verdict: 'approve', score: 0.02 } },
      () => {
        sqlite.exec("UPDATE data_cards SET data='{\"text\":\"别的改动\"}', updated_at='2026-01-04' WHERE id='card-cw'");
      },
    );
    const r = await autoReviewLatestPendingPublicDataCardUpdatesForUser(1, { db: db as never, engine, policy: basePolicy });
    expect(r.approvedCount).toBe(0);
    expect(r.heldCount).toBe(1);
    // 卡片保留用户的新内容，待审更新行未被消费
    expect(sqlite.prepare("SELECT data v FROM data_cards WHERE id='card-cw'").get()!.v).toBe('{"text":"别的改动"}');
    expect(sqlite.prepare('SELECT COUNT(*) c FROM data_card_updates').get()!.c).toBe(1);
  });
});
