'use client';

import { useEffect, useState } from 'react';

/**
 * 房间标题自动命名：用户名异步加载完成前组件可能已以「玩家」初始化
 * （useState initializer 只运行一次）。这里保证在用户未手动改过标题时，
 * 标题始终跟随最新 displayName；一旦用户输入过（touched），不再覆盖。
 */
export const useArenaRoomAutoTitle = (
  displayName: string,
): readonly [string, (value: string) => void] => {
  const fallback = displayName || '玩家';
  const [roomTitle, setRoomTitle] = useState(() => `${fallback} 的房间`);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setRoomTitle(`${fallback} 的房间`);
  }, [fallback, touched]);
  return [
    roomTitle,
    (value: string) => {
      setTouched(true);
      setRoomTitle(value);
    },
  ] as const;
};
