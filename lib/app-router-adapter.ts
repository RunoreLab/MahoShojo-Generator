'use client';

import { useRouter } from 'next/navigation';

type QueryValue = string | number | boolean | null | undefined;
export type AppRouterPushTarget = string | {
  pathname: string;
  query?: Record<string, QueryValue | QueryValue[]>;
};
export type AppRouterAdapter = {
  push(target: AppRouterPushTarget): void;
  replace(target: AppRouterPushTarget): void;
  refresh(): void;
  back(): void;
};

const buildHref = (target: AppRouterPushTarget): string => {
  if (typeof target === 'string') return target;

  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(target.query ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === null || value === undefined) continue;
      params.append(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
};

export function useAppRouterAdapter(): AppRouterAdapter {
  const router = useRouter();

  return {
    push(target: AppRouterPushTarget) {
      router.push(buildHref(target));
    },
    replace(target: AppRouterPushTarget) {
      router.replace(buildHref(target));
    },
    refresh() {
      router.refresh();
    },
    back() {
      router.back();
    },
  };
}
