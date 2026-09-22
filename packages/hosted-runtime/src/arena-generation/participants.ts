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
