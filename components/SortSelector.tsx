import React from 'react';

type SortOption = 'likes' | 'usage' | 'favorites' | 'created_at';

interface SortSelectorProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  className?: string;
}

export default function SortSelector({ value, onChange, className = '' }: SortSelectorProps) {
  const sortOptions = [
    { value: 'created_at', label: '发布时间' },
    { value: 'likes', label: '点赞数' },
    { value: 'usage', label: '使用数' },
    { value: 'favorites', label: '收藏数' }
  ] as const;

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <span className="text-sm text-gray-600 whitespace-nowrap">排序</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOption)}
        className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
