import React from 'react';

import { getProviderCooldownNoticeText, type ProviderCooldownMode } from '@/lib/cooldown';

type ProviderCooldownNoticeProps = {
  currentMode: ProviderCooldownMode;
  currentIsCooldown: boolean;
  otherRemainingTime: number;
  className?: string;
};

export function ProviderCooldownNotice({
  currentMode,
  currentIsCooldown,
  otherRemainingTime,
  className = 'mt-2 text-xs text-amber-700',
}: ProviderCooldownNoticeProps) {
  const text = getProviderCooldownNoticeText({
    currentMode,
    currentIsCooldown,
    otherRemainingTime,
  });

  if (!text) return null;

  return <p className={className}>{text}</p>;
}
