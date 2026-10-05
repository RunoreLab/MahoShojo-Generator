import { useCallback, useState } from 'react';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import type { CardRepository } from '@mahoshojo/local-library/repository';

import { saveLocalDataCard } from './save-local-data-card';

export interface LocalLibraryAutoSaveInput {
  cardType: OnlineDataCardType;
  title: string;
  payload: unknown;
}

export interface LocalLibraryAutoSaveResult {
  saved: number;
  updated: number;
  failed: number;
  /** 同内容记录在回收站中、未写入的条数；需要用户到本地库显式恢复。 */
  inRecycleBin: number;
}

/**
 * 「导入时保存到本地库」的执行端。
 *
 * 去重规则是内容摘要 + **整卡替换**：摘要相同就更新那一行，不新增。
 * 逐字段合并会造出用户从未写过的第三态，本地库一旦开始堆积似曾相识的卡就再也分不清真假。
 */
export const useLocalLibraryAutoSave = (repository: Pick<CardRepository, 'get' | 'put'>) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LocalLibraryAutoSaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async (entries: LocalLibraryAutoSaveInput[]): Promise<LocalLibraryAutoSaveResult> => {
    const empty: LocalLibraryAutoSaveResult = { saved: 0, updated: 0, failed: 0, inRecycleBin: 0 };
    if (entries.length === 0) {
      setResult(empty);
      return empty;
    }
    setBusy(true);
    setError(null);
    try {
      const summary: LocalLibraryAutoSaveResult = { ...empty };
      for (const entry of entries) {
        try {
          const outcome = await saveLocalDataCard(repository, { ...entry, execution: 'imported' });
          if (outcome.inRecycleBin) summary.inRecycleBin += 1;
          else if (outcome.updated) summary.updated += 1;
          else summary.saved += 1;
        } catch {
          // 单条失败不阻断其余条目：一次多文件导入不该因为其中一张卡不可存就全盘失败。
          summary.failed += 1;
        }
      }
      setResult(summary);
      if (summary.failed > 0) {
        setError(`${summary.failed} 条内容未能写入本地库（可能超出浏览器存储配额）。`);
      }
      return summary;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存到本地库失败。');
      setResult(null);
      return empty;
    } finally {
      setBusy(false);
    }
  }, [repository]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { save, busy, result, error, reset };
};
