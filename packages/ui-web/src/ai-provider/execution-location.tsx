// 「AI 执行：客户端｜服务器」的共源位置控件与解析。
//
// 规格（SPEC-desktop-online DESK-ONLINE-001/004）：界面用「客户端｜服务器」区分执行
// 位置，与「流式｜非流式」正交。这里只表达 UI 级位置；`direct-local`/`direct-remote`
// 的落地由调用方按连接 endpoint 判定（本机服务 vs 远端服务），`hosted`/`authoritative`
// 属于服务器侧模式，不在本控件直接暴露。

import { Cloud, Laptop } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  SegmentedControl,
  type SegmentedOption,
} from '../details-controls/SegmentedControl';

export type AiExecutionLocation = 'client' | 'server';

export interface AiExecutionLocationOptionState {
  /** 该位置当前是否可选。 */
  enabled: boolean;
  /** 不可选时的原因说明（如「服务器执行将在接入在线能力后开放」）。 */
  reason?: string;
}

export interface AiExecutionLocationResolution {
  /** 生效位置。 */
  location: AiExecutionLocation;
  /** 生效位置与用户偏好不一致（被禁用项强制回退）时的解释；否则 null。 */
  fallbackReason: string | null;
}

export interface ResolveAiExecutionLocationInput {
  /** 用户显式偏好；null/未提供表示未选择。 */
  preference?: AiExecutionLocation | null;
  client: AiExecutionLocationOptionState;
  server: AiExecutionLocationOptionState;
  /** 无偏好或偏好不可用时的默认位置；缺省 'client'。 */
  defaultLocation?: AiExecutionLocation;
}

/**
 * 纯解析：偏好优先；偏好不可用则回退 defaultLocation，defaultLocation 也不可用时
 * 退到另一个可用位置；两个位置都不可用时仍返回 defaultLocation（由调用方决定
 * 如何禁用操作）。
 */
export const resolveAiExecutionLocation = (
  input: ResolveAiExecutionLocationInput,
): AiExecutionLocationResolution => {
  const defaultLocation = input.defaultLocation ?? 'client';
  const preference = input.preference ?? null;
  const otherLocation: AiExecutionLocation =
    defaultLocation === 'client' ? 'server' : 'client';

  if (preference && input[preference].enabled) {
    return { location: preference, fallbackReason: null };
  }

  const fallback = input[defaultLocation].enabled
    ? defaultLocation
    : input[otherLocation].enabled
      ? otherLocation
      : defaultLocation;

  // fallbackReason 解释「为什么生效位置不是想要的位置」：优先用被跳过的偏好原因；
  // 无偏好但默认位置不可用时，说明默认位置为何不可用；仍落到不可用位置时给通用提示。
  const skipped = preference ?? (fallback === defaultLocation ? null : defaultLocation);
  return {
    location: fallback,
    fallbackReason:
      (skipped ? input[skipped].reason : null) ??
      (input[fallback].enabled ? null : input[fallback].reason ?? '当前没有可用的执行位置'),
  };
};

export interface AiExecutionLocationFieldProps {
  /** 当前生效（解析后）的位置。 */
  value: AiExecutionLocation;
  client: AiExecutionLocationOptionState;
  server: AiExecutionLocationOptionState;
  onChange?: (location: AiExecutionLocation) => void;
  label?: ReactNode;
}

/**
 * 「AI 执行：客户端｜服务器」分段选择。
 * 不可用的选项渲染为禁用并附原因，不提供空转按钮（DESK-ONLINE-001）。
 *
 * DESK-AIP-009.7：消费与 `GenerationModeSwitcher` 相同的 `SegmentedControl`
 * 轨道/图标/激活态/焦点与响应式样式，不再保留独立的紧凑小开关实现。
 */
export const AiExecutionLocationField = ({
  value,
  client,
  server,
  onChange,
  label = 'AI 执行',
}: AiExecutionLocationFieldProps) => {
  const options: readonly SegmentedOption<AiExecutionLocation>[] = [
    {
      value: 'client',
      label: '客户端',
      icon: <Laptop />,
      description:
        '由本机直接连接你已配置的模型服务（客户端 Direct），请求不经过项目服务器。',
      disabled: !client.enabled,
      ...(client.reason !== undefined ? { reason: client.reason } : {}),
    },
    {
      value: 'server',
      label: '服务器',
      icon: <Cloud />,
      description:
        '由项目服务器代为生成（使用系统默认配置 / 云端通路），不使用客户端连接与本地凭据。',
      disabled: !server.enabled,
      ...(server.reason !== undefined ? { reason: server.reason } : {}),
    },
  ];

  const disabledReason = options.find((option) => option.disabled)?.reason;

  return (
    <div className="input-group">
      <SegmentedControl
        label={label}
        value={value}
        options={options}
        onChange={(location) => onChange?.(location)}
      />
      {disabledReason && (
        <p className="battle-lite-subtle-text mt-1 text-xs">{disabledReason}</p>
      )}
    </div>
  );
};
