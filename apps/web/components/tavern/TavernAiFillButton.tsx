import React from 'react';

export interface TavernAiFillButtonProps {
  loading: boolean;
  disabled: boolean;
  cooldownSeconds?: number;
  onClick: () => void;
}

export function TavernAiFillButton({ loading, disabled, cooldownSeconds, onClick }: TavernAiFillButtonProps) {
  const isCooldown = typeof cooldownSeconds === 'number' && cooldownSeconds > 0;
  const label = loading ? 'AI 生成中…' : isCooldown ? `冷却中 (${cooldownSeconds}s)` : 'AI 生成';
  return (
    <button
      type="button"
      className="generate-button w-auto mb-0 px-4 py-2 text-sm"
      style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #d946ef)' }}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
