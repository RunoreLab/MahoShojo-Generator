'use client';

import { FileCheck2, Waves } from 'lucide-react';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

export type GenerationMode = 'non-stream' | 'stream';

const MODE_OPTIONS: readonly SegmentedOption<GenerationMode>[] = [
  { value: 'non-stream', label: '非流式', icon: <FileCheck2 />, description: '等待生成结束后一次性显示完整结果；等待期间不逐段显示正文。' },
  { value: 'stream', label: '流式', icon: <Waves />, description: '生成过程中逐步接收内容，可边生成边阅读；Web 战报会在完整生成后展示互动页面。' },
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
      <SegmentedControl label={props.label || '选择生成方式'} value={value} options={MODE_OPTIONS} onChange={props.onChange} disabled={disabled} />
      {renderHelper()}
    </div>
  );
}
