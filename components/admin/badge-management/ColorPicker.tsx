import React from 'react';

interface ColorPickerProps {
  label: string;
  required?: boolean;
  type: 'solid' | 'gradient';
  onTypeChange: (type: 'solid' | 'gradient') => void;
  solidValue: string;
  onSolidChange: (value: string) => void;
  gradientStart: string;
  onGradientStartChange: (value: string) => void;
  gradientEnd: string;
  onGradientEndChange: (value: string) => void;
}

export default function ColorPicker({
  label,
  required = false,
  type,
  onTypeChange,
  solidValue,
  onSolidChange,
  gradientStart,
  onGradientStartChange,
  gradientEnd,
  onGradientEndChange
}: ColorPickerProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      {/* 类型选择 */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onTypeChange('solid')}
          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
            type === 'solid'
              ? 'bg-purple-100 border-purple-500 text-purple-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          纯色
        </button>
        <button
          type="button"
          onClick={() => onTypeChange('gradient')}
          className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
            type === 'gradient'
              ? 'bg-purple-100 border-purple-500 text-purple-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          渐变
        </button>
      </div>

      {/* 颜色输入 */}
      {type === 'solid' ? (
        <div className="flex gap-2">
          <input
            type="color"
            value={solidValue}
            onChange={(e) => onSolidChange(e.target.value)}
            className="w-16 h-10 rounded border border-gray-300 cursor-pointer"
          />
          <input
            type="text"
            value={solidValue}
            onChange={(e) => onSolidChange(e.target.value)}
            placeholder="#FFFFFF"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 w-12">起始</span>
            <input
              type="color"
              value={gradientStart}
              onChange={(e) => onGradientStartChange(e.target.value)}
              className="w-16 h-10 rounded border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={gradientStart}
              onChange={(e) => onGradientStartChange(e.target.value)}
              placeholder="#667eea"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-sm"
            />
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 w-12">结束</span>
            <input
              type="color"
              value={gradientEnd}
              onChange={(e) => onGradientEndChange(e.target.value)}
              className="w-16 h-10 rounded border border-gray-300 cursor-pointer"
            />
            <input
              type="text"
              value={gradientEnd}
              onChange={(e) => onGradientEndChange(e.target.value)}
              placeholder="#764ba2"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 font-mono text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
