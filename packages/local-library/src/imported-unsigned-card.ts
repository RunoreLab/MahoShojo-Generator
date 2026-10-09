import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from './digest';
import { LocalCardRecordV1Schema } from './record';
import type { CardRepository } from './repository';

/** A new local projection, not proof that an attached source or nested signature is official. */
export async function saveImportedUnsignedCharacter(repository: CardRepository, data: unknown, title: string): Promise<'saved' | 'already-present'> {
  const digest = await digestLocalCardPayloadV1(data);
  const now = new Date().toISOString();
  const record = LocalCardRecordV1Schema.parse({
    id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local',
    cardType: 'character', title, data, contentDigest: digest,
    provenance: { kind: 'unsigned', execution: 'imported' }, createdAt: now, updatedAt: now,
  });
  const result = await repository.putIfAbsent(record);
  if ('written' in result) return 'saved';
  const existing = await repository.get(record.id);
  if (!existing || existing.deletedAt !== undefined) throw new Error('相同内容在回收站或暂不可读，请先到本地库检查；未覆盖任何记录。');
  return 'already-present';
}
