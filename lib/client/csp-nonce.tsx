import { createContext, useContext } from 'react';

export const CspNonceContext = createContext<string | undefined>(undefined);

export function useCspNonce(): string | undefined {
  return useContext(CspNonceContext);
}
