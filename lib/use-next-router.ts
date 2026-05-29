import * as NextRouterModule from 'next/router';
import type { NextRouter } from 'next/router';

type NextRouterInteropModule = typeof NextRouterModule & {
  default?: {
    useRouter?: () => NextRouter;
  };
};

export function useNextRouter(): NextRouter {
  const routerModule = NextRouterModule as NextRouterInteropModule;
  const useRouter = routerModule.useRouter ?? routerModule.default?.useRouter;

  if (!useRouter) {
    throw new Error('next/router useRouter is unavailable');
  }

  return useRouter();
}
