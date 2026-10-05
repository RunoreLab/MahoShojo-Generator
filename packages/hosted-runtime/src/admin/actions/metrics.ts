import { z } from 'zod';
import { computeTechIndex } from '../../metrics/tech-index';
import { defineAction, fields, mutationInput, snapshot, type AdminBusinessAction } from './core';

export function createAdminMetricsActions(options: { verifySignature?: (_data: unknown) => Promise<boolean> } = {}): AdminBusinessAction[] {
  return [defineAction({ name: 'cards.metrics', label: '重新计算技术值与原生性', resource: 'data-cards', capability: 'content.write', fields: fields([['id', '数据卡 ID', 'text'], ['expectedVersion', '数据版本', 'text']]) }, z.object(mutationInput).strict(), async (db, input) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    const raw = current.row?.data;
    if (typeof raw === 'string' && raw.length > 1_000_000) throw new Error('ADMIN_METRICS_CARD_TOO_LARGE');
    const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : 'null');
    const tech = computeTechIndex(parsed);
    const isNative = options.verifySignature ? await options.verifySignature(parsed) : null;
    const now = new Date().toISOString();
    const previous = await db.prepare('SELECT created_at FROM data_card_metrics WHERE data_card_id=?').bind(input.id).first<{ created_at: string }>();
    return { targetId: input.id, plan: {
      primary: { name: 'claim-card-metrics', sql: `UPDATE data_cards SET updated_at=updated_at WHERE ${current.where} AND deleted_at IS NULL AND {{admin_guard}}`, bindings: current.bindings },
      effects: [{ name: 'clear-card-metrics', sql: 'DELETE FROM data_card_metrics WHERE data_card_id=? AND {{admin_guard}}', bindings: [input.id] },
        { name: 'write-card-metrics', expectedChanges: 1, sql: 'INSERT INTO data_card_metrics (data_card_id,tech_score,tech_level,is_native,data_card_updated_at,details_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE {{admin_guard}}',
          bindings: [input.id, tech.techScore, tech.techLevel, isNative === null ? null : Number(isNative), current.row?.updated_at ?? '', JSON.stringify({ raw: tech.raw, derived: tech.derived, components: tech.components, notes: tech.notes }), previous?.created_at ?? now, now] }],
      result: { id: input.id, techScore: tech.techScore, techLevel: tech.techLevel, isNative },
    } };
  })];
}
