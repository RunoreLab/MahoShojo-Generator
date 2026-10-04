import { adminAggregateRows } from './analytics';
import type { AdminReadDatabase } from './read-models';

type Row = Record<string, string | number | null>;
export async function readAdminArenaRisk(db: AdminReadDatabase, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const since1 = new Date(now.getTime() - 86_400_000).toISOString();
  const end = now.toISOString();
  const summary = await adminAggregateRows<Row>(db, `SELECT count(*) AS total30d,count(DISTINCT user_id) AS distinct_users30d,count(DISTINCT pair_key) AS distinct_pairs30d,
    coalesce(sum(status='applied'),0) AS applied30d,coalesce(sum(status='skipped'),0) AS skipped30d,coalesce(sum(status='failed'),0) AS failed30d,
    coalesce(sum(created_at>=? AND status='applied'),0) AS applied7d,coalesce(sum(created_at>=? AND status='skipped'),0) AS skipped7d,coalesce(sum(created_at>=? AND status='failed'),0) AS failed7d,
    coalesce(sum(created_at>=? AND status='applied'),0) AS applied24h,coalesce(sum(created_at>=? AND status='skipped'),0) AS skipped24h,coalesce(sum(created_at>=? AND status='failed'),0) AS failed24h
    FROM arena_rating_events WHERE created_at>=? AND created_at<=?`, [since7, since7, since7, since1, since1, since1, since30, end]);
  const skipReasons = await adminAggregateRows<Row>(db, 'SELECT skip_reason,count(*) AS count30d,sum(created_at>=?) AS count7d,sum(created_at>=?) AS count24h FROM arena_rating_events WHERE created_at>=? AND created_at<=? AND skip_reason IS NOT NULL GROUP BY skip_reason ORDER BY count30d DESC,skip_reason LIMIT 100', [since7, since1, since30, end]);
  const topUsers = await adminAggregateRows<Row>(db, "SELECT user_id,count(*) AS events30d,sum(status='applied') AS applied30d,sum(status='skipped') AS skipped30d,count(DISTINCT pair_key) AS pair_count30d FROM arena_rating_events WHERE created_at>=? AND created_at<=? AND user_id IS NOT NULL GROUP BY user_id ORDER BY events30d DESC,user_id LIMIT 100", [since30, end]);
  const topPairs = await adminAggregateRows<Row>(db, "SELECT pair_key,a_entity_type,a_entity_id,b_entity_type,b_entity_id,count(*) AS events30d,sum(status='applied') AS applied30d,sum(status='skipped') AS skipped30d,count(DISTINCT user_id) AS distinct_users30d,max(created_at) AS last_event_at FROM arena_rating_events WHERE created_at>=? AND created_at<=? GROUP BY pair_key,a_entity_type,a_entity_id,b_entity_type,b_entity_id ORDER BY events30d DESC,pair_key LIMIT 100", [since30, end]);
  return { generatedAt: end, summary: summary[0], skipReasons, topUsers, topPairs };
}
