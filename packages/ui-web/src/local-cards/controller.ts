import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';

/**
 * 本地数据卡列表背后的仓储面。
 *
 * 只取 `CardRepository` 的 `list/delete/restore`，再加两端仓储都已实现的 `purge`（`DESK-PROD-003`
 * 不新建 port）。`list` 允许额外返回 `unreadable`：两端 adapter 都会跳过无法解析的行并报出 id，界面
 * 需要把它说出来，而不是让坏行静默消失。
 */
export type LocalCardsStore = Pick<CardRepository, 'list' | 'delete' | 'restore'> & {
  readonly purge: (id: string) => Promise<void>;
};

export interface LocalCardsHost {
  readonly store: LocalCardsStore;
  /** 把任意失败翻译成用户可读的文案。 */
  readonly describeError: (cause: unknown) => string;
}

export type LocalCardsViewKind = 'active' | 'recycle';
export type LocalCardMutation = 'delete' | 'restore' | 'purge';

export interface LocalCardsModel {
  readonly view: LocalCardsViewKind;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly loadError: string | null;
  /** 当前视图的记录：活动视图不含墓碑，回收站只含墓碑。 */
  readonly records: readonly LocalCardRecordV1[];
  readonly unreadableCount: number;
  readonly pending: Readonly<{ id: string; action: LocalCardMutation }> | null;
  readonly actionError: string | null;
  readonly notice: string | null;
}

export interface LocalCardsActions {
  readonly reload: () => void;
  readonly setView: (view: LocalCardsViewKind) => void;
  readonly remove: (id: string) => void;
  readonly restore: (id: string) => void;
  readonly purge: (id: string) => void;
  readonly dismissMessages: () => void;
}

export interface LocalCardsController {
  readonly model: LocalCardsModel;
  readonly actions: Readonly<LocalCardsActions>;
  readonly subscribe: (listener: () => void) => () => void;
  /** 写操作在途。宿主据此把它纳入自己的维护互斥。 */
  readonly isBusy: () => boolean;
}

const PAGE_LIMIT = 100;

const MUTATION_NOTICE: Record<LocalCardMutation, string> = {
  delete: '已移入回收站，可在回收站恢复。',
  restore: '已从回收站恢复。',
  purge: '已从本机彻底删除。',
};

/**
 * 逐页读完一个视图。
 *
 * 搜索与筛选覆盖标题与类型，必须看到全集；本地库规模由用户自己的导入量决定，与 Web 既有的
 * `useLocalDataCards` 同一取舍。游标重复视为仓储故障而不是循环读下去。
 */
const readView = async (
  store: LocalCardsStore,
  view: LocalCardsViewKind,
): Promise<{ records: LocalCardRecordV1[]; unreadableCount: number }> => {
  const records: LocalCardRecordV1[] = [];
  const unreadable = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await store.list({
      limit: PAGE_LIMIT,
      ...(view === 'recycle' ? { includeDeleted: true } : {}),
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const record of page.items) {
      if ((record.deletedAt !== undefined) === (view === 'recycle')) records.push(record);
    }
    const skipped = (page as { unreadable?: unknown }).unreadable;
    if (Array.isArray(skipped)) {
      for (const id of skipped) unreadable.add(String(id));
    }
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) throw new Error('本地库返回了重复的分页游标，列表读取已中止。');
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);
  if (view === 'recycle') {
    records.sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? '') || left.id.localeCompare(right.id));
  }
  return { records, unreadableCount: unreadable.size };
};

/**
 * 创建本地数据卡列表控制器。
 *
 * 纯状态机：不含 React、不碰具体存储。两条竞态规则由它统一保证，而不是靠两端页面各自记得：
 *
 * - **读代次**：每次读取（含切换视图）递增代次，晚到的旧响应直接丢弃，因此回收站的结果不会写进活动
 *   列表，反之亦然（`DESK-PROD-006` 切换来源的竞态要求）。
 * - **写单飞**：一次只允许一个写操作，`pending` 同步置位，快速双击不会在重渲染前绕过禁用态。
 */
export const createLocalCardsController = (host: LocalCardsHost): LocalCardsController => {
  let model: LocalCardsModel = {
    view: 'active',
    status: 'idle',
    loadError: null,
    records: [],
    unreadableCount: 0,
    pending: null,
    actionError: null,
    notice: null,
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const setModel = (next: Partial<LocalCardsModel>): void => {
    model = { ...model, ...next };
    for (const listener of listeners) listener();
  };

  const load = async (): Promise<void> => {
    const current = ++generation;
    const view = model.view;
    setModel({ status: 'loading', loadError: null });
    try {
      const { records, unreadableCount } = await readView(host.store, view);
      if (current !== generation) return;
      setModel({ status: 'ready', records, unreadableCount });
    } catch (cause) {
      if (current !== generation) return;
      setModel({ status: 'error', records: [], unreadableCount: 0, loadError: host.describeError(cause) });
    }
  };

  const mutate = async (id: string, action: LocalCardMutation): Promise<void> => {
    if (model.pending !== null) return;
    setModel({ pending: { id, action }, actionError: null, notice: null });
    try {
      if (action === 'delete') await host.store.delete(id);
      else if (action === 'restore') await host.store.restore(id);
      else await host.store.purge(id);
      setModel({ pending: null, notice: MUTATION_NOTICE[action] });
    } catch (cause) {
      setModel({ pending: null, actionError: host.describeError(cause) });
    }
    // 成功与失败都重读：失败时仓储状态未知（例如 native 已写入但响应丢失），以存储为准而不是猜。
    await load();
  };

  return {
    get model() {
      return model;
    },
    actions: {
      reload: () => {
        void load();
      },
      setView: (view) => {
        if (view === model.view) return;
        setModel({ view, records: [], unreadableCount: 0, actionError: null, notice: null });
        void load();
      },
      remove: (id) => {
        void mutate(id, 'delete');
      },
      restore: (id) => {
        void mutate(id, 'restore');
      },
      purge: (id) => {
        void mutate(id, 'purge');
      },
      dismissMessages: () => {
        setModel({ actionError: null, notice: null });
      },
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isBusy: () => model.pending !== null,
  };
};
