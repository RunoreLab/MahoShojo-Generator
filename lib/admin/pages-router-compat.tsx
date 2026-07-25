'use client';

import { usePathname, useRouter as useNavigationRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

/**
 * 提供 next/router (Pages Router) 风格的 useRouter 接口，
 * 底层使用 next/navigation (App Router) 实现。
 *
 * 仅覆盖 admin 组件实际使用的 API 子集：
 * - router.push({ pathname, query })
 * - router.query (URL search params 的只读视图)
 * - router.pathname
 * - router.isReady (始终为 true)
 */
export function usePagesRouterCompat() {
  const router = useNavigationRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(() => {
    if (!searchParams) return {};
    const result: Record<string, string | string[]> = {};
    searchParams.forEach((value, key) => {
      if (key in result) {
        const existing = result[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          result[key] = [existing, value];
        }
      } else {
        result[key] = value;
      }
    });
    return result;
  }, [searchParams]);

  return useMemo(() => ({
    push: (
      url: string | { pathname: string; query?: Record<string, string | undefined> },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._rest: unknown[]
    ) => {
      if (typeof url === 'string') {
        return router.push(url);
      }
      const { pathname: targetPathname, query: targetQuery } = url;
      if (targetQuery && Object.keys(targetQuery).length > 0) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(targetQuery)) {
          if (value !== undefined && value !== null) {
            params.set(key, value);
          }
        }
        return router.push(`${targetPathname}?${params.toString()}`);
      }
      return router.push(targetPathname);
    },
    replace: (url: string | { pathname: string; query?: Record<string, string | undefined> }) => {
      if (typeof url === 'string') {
        return router.replace(url);
      }
      const { pathname: targetPathname, query: targetQuery } = url;
      if (targetQuery && Object.keys(targetQuery).length > 0) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(targetQuery)) {
          if (value !== undefined && value !== null) {
            params.set(key, value);
          }
        }
        return router.replace(`${targetPathname}?${params.toString()}`);
      }
      return router.replace(targetPathname);
    },
    back: () => router.back(),
    prefetch: (url: string) => router.prefetch(url),
    query,
    pathname: pathname ?? '/',
    isReady: true,
    events: {
      on: () => {},
      off: () => {},
      emit: () => {},
    },
  }), [router, pathname, query]);
}
