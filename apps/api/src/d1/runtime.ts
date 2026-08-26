import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { getHonoPrimaryD1Client } from '#/d1/provider';

const isReadinessRow = (value: unknown): value is { ok: number } => (
  typeof value === 'object'
  && value !== null
  && (value as { ok?: unknown }).ok === 1
);

export const probeD1Readiness = async (
  client: NodeDataD1Client | null = getHonoPrimaryD1Client(),
): Promise<boolean> => {
  if (!client) return false;
  try {
    const result = await client
      .prepare('SELECT 1 AS ok')
      .all({ retry: 'safe-read' });
    return result.success
      && result.results.length === 1
      && isReadinessRow(result.results[0]);
  } catch {
    console.error('[hono][health] D1 探测失败');
    return false;
  }
};
