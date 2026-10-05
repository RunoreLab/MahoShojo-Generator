export type StreamStopButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  className?: string;
};

export function StreamStopButton({
  onClick,
  disabled = false,
  compact = false,
  label = '停止生成',
  className = '',
}: StreamStopButtonProps) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-base text-red-700 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900 ${className}`}
      >
        ⏹
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`generate-button ${className}`}
      style={{ backgroundColor: '#ef4444', backgroundImage: 'linear-gradient(to right, #ef4444, #dc2626)' }}
    >
      ⏹ {label}
    </button>
  );
}
