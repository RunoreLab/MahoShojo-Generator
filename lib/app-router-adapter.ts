'use client';

import { useRouter } from 'next/navigation';

type QueryValue = string | number | boolean | null | undefined;
type RouterPushTarget = string | {
  pathname: string;
  query?: Record<string, QueryValue | QueryValue[]>;
};

const buildHref = (target: RouterPushTarget): string => {
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

export function useAppRouterAdapter() {
  const router = useRouter();

  return {
    push(target: RouterPushTarget) {
      router.push(buildHref(target));
    },
    replace(target: RouterPushTarget) {
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
