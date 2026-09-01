import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
  type StorageValue,
} from 'zustand/middleware';

const isPromiseLike = <T,>(value: unknown): value is PromiseLike<T> =>
  Boolean(value && typeof (value as PromiseLike<T>).then === 'function');

/**
 * `skipHydration` 只延迟读取，不会阻止 persist 中间件在读取前写入默认快照。
 * 这里在首次成功读取 storage 前丢弃 setItem，避免任意早期 state update 覆盖用户已保存的数据。
 */
export const createHydrationSafeJsonStorage = <State>(
  getStorage: () => StateStorage,
): PersistStorage<State> | undefined => {
  const storage = createJSONStorage<State>(getStorage);
  if (!storage) return undefined;

  let hasReadStorage = false;

  return {
    getItem: (name) => {
      const storedValue = storage.getItem(name);
      if (isPromiseLike<StorageValue<State> | null>(storedValue)) {
        return Promise.resolve(storedValue).then((value) => {
          hasReadStorage = true;
          return value;
        });
      }
      hasReadStorage = true;
      return storedValue;
    },
    setItem: (name, value) => {
      if (!hasReadStorage) return undefined;
      return storage.setItem(name, value);
    },
    removeItem: (name) => storage.removeItem(name),
  };
};
