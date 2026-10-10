import { FileCheck2, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
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
  /**
   * 「生成方式」下方的业务说明（DESK-AIP-009.4）。
   * - `true` / 缺省：沿用内置战报默认文案（仅战报类页面适用）；
   * - `false` / `null`：不渲染 helper——非战报页必须关闭默认战报文案；
   * - 其他 ReactNode：渲染宿主提供的上下文说明。
   */
  helper?: boolean | ReactNode;
  /**
   * 选项级禁用原因（DESK-AIP-009.9）：如客户端 Direct 不支持页面可见流式
   * Markdown 时把 `stream` 标记为不可用并解释；不会静默改写当前选择。
   */
  disabledReasons?: Partial<Record<GenerationMode, string>>;
  /** Host capability wording; absent values preserve the Web descriptions. */
  optionDescriptions?: Partial<Record<GenerationMode, string>>;
}) {
  const value = props.value;
  const disabled = props.disabled === true;
  const helper = props.helper;

  const options: readonly SegmentedOption<GenerationMode>[] = MODE_OPTIONS.map((original) => {
    const option = { ...original, description: props.optionDescriptions?.[original.value] ?? original.description };
    const reason = props.disabledReasons?.[option.value];
    return reason === undefined
      ? option
      : { ...option, disabled: true, reason };
  });

  const renderHelper = () => {
    if (helper === false || helper === null) return null;
    if (helper !== undefined && helper !== true) return helper;
    if (value === 'stream') {
      return (
        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-200">
          <p className="font-bold">你已选择【流式生成（实验性）】！</p>
          <p className="mt-1">实验性功能：会实时输出正文，体验更好，但也可能出现中断、格式异常、解析失败等问题。</p>
        </div>
      );
    }

    return (
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-200">
        <p className="font-bold">你已选择【非流式生成】！</p>
        <p className="mt-1">传统生成方式：等待片刻后一次性返回完整战报（胜者解析更稳定）。</p>
      </div>
    );
  };

  return (
    <div className="input-group">
      <SegmentedControl label={props.label || '选择生成方式'} value={value} options={options} onChange={props.onChange} disabled={disabled} />
      {renderHelper()}
    </div>
  );
}
