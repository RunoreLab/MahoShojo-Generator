'use client';

import { useRef } from 'react';

import {
  createGenerationApiIntentLatch,
  type GenerationApiIntentDependencies,
  type GenerationApiIntentLatch,
} from '@/lib/hono-api-client';

export const useGenerationApiIntentLatch = (
  dependencies: GenerationApiIntentDependencies = {},
): GenerationApiIntentLatch => {
  const latchRef = useRef<GenerationApiIntentLatch | null>(null);
  if (!latchRef.current) {
    latchRef.current = createGenerationApiIntentLatch(dependencies);
  }
  return latchRef.current;
};
