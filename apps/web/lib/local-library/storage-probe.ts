import { openLocalLibraryDb, LocalLibraryUnavailableError } from './db';

/**
 * 用「真的打开一次 IndexedDB」来判定本地库存储是否可用。
 *
 * ## 为什么不复用 `useLocalLibraryStorageStatus`
 *
 * 那个 hook 报告的是 `navigator.storage.estimate()` / `persist()` 这类**配额与持久化**信息，它答的是
 * 「浏览器会不会清理我」，不是「我现在能不能读��。配额正常但数据库打不开（隐私模式、被策略禁用、
 * 存储配额已满导致 open 失败）是完全可能的，而归档导入导出会直接失败。
 *
 * 两者必须分开呈现：配额不可用时用户需要去清缓存，数据库打不开时用户需要去看浏览器设置。合成一句
 * 「本地库不可用」会把用户引向错误的处置方式。
 *
 * ## 失败必须报告，不能退化成空库
 *
 * `DESK-PROD-007` 要求初始化失败 MUST 报告，不得悄悄退到易失内存后继续显示「已保存」。因此这里返回
 * **错误文案**而不是 `null`+静默继续。
 */
export const probeLocalLibraryStorage = async (): Promise<string | null> => {
  try {
    const db = await openLocalLibraryDb();
    // 立刻关掉：探测不应该长期占住一个连接，否则后续写入可能撞上 upgrade 阻塞。
    db.close();
    return null;
  } catch (cause) {
    if (cause instanceof LocalLibraryUnavailableError) {
      return cause.message;
    }
    return cause instanceof Error ? cause.message : '未知错误';
  }
};