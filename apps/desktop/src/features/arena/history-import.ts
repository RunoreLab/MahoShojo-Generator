import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { NarrativeHistorySchema } from '@mahoshojo/domain/narrative-history';
import { localLibraryRecordBytes } from '@mahoshojo/local-library/archive-export';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { parseArenaJson, readArenaFile } from './input';

/** Formal Web exports are stored intact, including unknown fields. No draft or source card is overwritten. */
export async function importDesktopHistoryFile(repository: CardRepository, file: File, signal: AbortSignal) {
  const data = parseArenaJson(await readArenaFile(file, signal));
  const parsed = NarrativeHistorySchema.safeParse(data);
  if (!parsed.success) throw new Error('请选择从叙事历史编辑器“导出 JSON”得到的正式历史文件；完整会话备份和未完成草稿不能在此导入。');
  if (!parsed.data.entries.length) throw new Error('该历史文件没有条目，未写入本地库。');
  const digest = await digestLocalCardPayloadV1(data);
  signal.throwIfAborted();
  const now = new Date().toISOString();
  const record = LocalCardRecordV1Schema.parse({
    id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', cardType: 'history',
    title: (parsed.data.title?.trim() || '导入的叙事历史').slice(0, 512), data, contentDigest: digest,
    provenance: { kind: 'unsigned', execution: 'imported' }, createdAt: now, updatedAt: now,
  });
  if (localLibraryRecordBytes(record).byteLength > MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES) {
    throw new Error('完整历史超过本地库单条 4 MiB 上限，未写入；请保留原文件，通过活动历史编辑器导入或拆分后再保存。');
  }
  const result = await repository.putIfAbsent(record);
  if ('alreadyPresent' in result) {
    const existing = await repository.get(record.id);
    if (!existing || existing.deletedAt) throw new Error('相同历史在回收站或暂不可读，请到本地库检查并显式恢复；原记录未覆盖。');
  }
  return { count: parsed.data.entries.length, alreadyPresent: 'alreadyPresent' in result };
}
