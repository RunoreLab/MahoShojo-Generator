'use client';

import { useEffect, useState } from 'react';

/**
 * 当前 URL 的 fragment。
 *
 * ## 为什么必须由客户端 effect 读，而不是在渲染期直接读 `window.location.hash`
 *
 * 百科条目页是 SSG 预渲染的（`generateStaticParams`），而 `apps/web/tests` 也有直接
 * `renderToStaticMarkup` 的用例。渲染期读 `window` 会在服务端抛错，也会让预渲染结果依赖构建时环境。
 *
 * 首帧返回空串、正文到达后再由 effect 补上，配合 `useHashScrollTarget` 的 `ready` 依赖正好覆盖
 * "正文是异步的"这个事实。
 */
export const useLocationHash = (): string => {
  const [hash, setHash] = useState('');

  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  return hash;
};