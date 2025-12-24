'use client';

export type GenerationMode = 'non-stream' | 'stream';

const MODE_OPTIONS: Array<{ key: GenerationMode; label: string }> = [
  { key: 'non-stream', label: '非流式' },
  { key: 'stream', label: '流式' },
];

export function GenerationModeSwitcher(props: {
  label?: string;
  value: GenerationMode;
  disabled?: boolean;
  onChange: (mode: GenerationMode) => void;
  helper?: boolean;
}) {
  const value = props.value;
  const disabled = props.disabled === true;
  const helper = props.helper !== false;

  const renderHelper = () => {
    if (!helper) return null;
    if (value === 'stream') {
      return (
        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <p className="font-bold">你已选择【流式生成（实验性）】！</p>
          <p className="mt-1">实验性功能：会实时输出正文，体验更好，但也可能出现中断、格式异常、解析失败等问题。</p>
        </div>
      );
    }

    return (
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-bold">你已选择【非流式生成】！</p>
        <p className="mt-1">传统生成方式：等待片刻后一次性返回完整战报（胜者解析更稳定）。</p>
      </div>
    );
  };

  return (
    <div className="input-group">
      <label className="input-label">{props.label || '选择生成方式'}</label>
      <div className="flex items-center space-x-1 bg-gray-200 p-1 rounded-full">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => props.onChange(option.key)}
            disabled={disabled}
            className={`w-1/2 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${
              value === option.key ? 'bg-white text-pink-600 shadow' : 'text-gray-600 hover:bg-gray-300'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {renderHelper()}
    </div>
  );
}

