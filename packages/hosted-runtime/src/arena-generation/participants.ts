import { ArenaMultiplayerParticipationSchema } from '@mahoshojo/contracts/arena-room';
import type { NodeDataD1Client } from '../node-runtime/data-ports';

export const persistArenaGenerationParticipants = async (
  client: NodeDataD1Client,
  generationId: string,
  evidence: unknown,
): Promise<void> => {
  if (evidence === undefined || evidence === null) return;
  // A malformed recovery manifest must not be marked complete.
  const snapshot = ArenaMultiplayerParticipationSchema.parse(evidence);
  // Check existing evidence before adding access. Partial retries and legacy NULL roles are valid.
  const stored = await client.prepare(`SELECT user_id, role
FROM battle_report_generation_participants WHERE generation_id = ? LIMIT ?`)
    .bind(generationId, snapshot.participantUserIds.length + 1).all();
  if (!stored.success) throw new Error('ARENA_PARTICIPANTS_READ_FAILED');
  const rows = stored.results ?? [];
  if (rows.some((row) => {
    const userId = Number(row.user_id);
    const expectedRole = userId === snapshot.hostAccountUserId ? 'host' : 'member';
    return !snapshot.participantUserIds.includes(userId)
      || (snapshot.hostAccountUserId !== undefined && row.role !== null && row.role !== expectedRole);
  })) {
    throw new Error('ARENA_PARTICIPANTS_EVIDENCE_CONFLICT');
  }

  for (let offset = 0; offset < snapshot.participantUserIds.length; offset += 16) {
    const ids = snapshot.participantUserIds.slice(offset, offset + 16);
    await client.prepare(`INSERT INTO battle_report_generation_participants (generation_id, user_id, role)
VALUES ${ids.map(() => '(?, ?, ?)').join(', ')}
ON CONFLICT (generation_id, user_id) DO NOTHING`).bind(...ids.flatMap((userId) => [
      generationId, userId,
      snapshot.hostAccountUserId === undefined ? null : userId === snapshot.hostAccountUserId ? 'host' : 'member',
    ])).run({ retry: 'none' });
  }
};
