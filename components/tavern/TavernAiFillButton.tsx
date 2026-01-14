import React from 'react';

export interface TavernAiFillButtonProps {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function TavernAiFillButton({ loading, disabled, onClick }: TavernAiFillButtonProps) {
  return (
    <button
      type="button"
      className="generate-button w-auto mb-0 px-4 py-2 text-sm"
      style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #d946ef)' }}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? 'AI 生成中…' : 'AI 生成开场白/对话样例'}
    </button>
  );
}

