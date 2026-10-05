// 「AI 执行：客户端｜服务器」的共源位置控件与解析。
//
// 规格（SPEC-desktop-online DESK-ONLINE-001/004）：界面用「客户端｜服务器」区分执行
// 位置，与「流式｜非流式」正交。这里只表达 UI 级位置；`direct-local`/`direct-remote`
// 的落地由调用方按连接 endpoint 判定（本机服务 vs 远端服务），`hosted`/`authoritative`
// 属于服务器侧模式，不在本控件直接暴露。

import type { ReactNode } from 'react';

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
 * 纯解析：偏好优先，偏好不可用则按 defaultLocation 回退并给出原因；
 * 两个位置都不可用时仍返回 defaultLocation（由调用方决定如何禁用操作）。
 */
export const resolveAiExecutionLocation = (
  input: ResolveAiExecutionLocationInput,
): AiExecutionLocationResolution => {
  const defaultLocation = input.defaultLocation ?? 'client';
  const preference = input.preference ?? null;

  if (preference && input[preference].enabled) {
    return { location: preference, fallbackReason: null };
  }

  const preferredReason = preference ? input[preference].reason : null;
  const fallback = input[defaultLocation].enabled ? defaultLocation : preference && input[preference].enabled ? preference : defaultLocation;
  return {
    location: fallback,
    fallbackReason: preferredReason ?? (input[fallback].enabled ? null : (input[fallback].reason ?? '当前没有可用的执行位置')),
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
 */
export const AiExecutionLocationField = ({
  value,
  client,
  server,
  onChange,
  label = 'AI 执行',
}: AiExecutionLocationFieldProps) => {
  const options: ReadonlyArray<{ key: AiExecutionLocation; label: string; state: AiExecutionLocationOptionState }> = [
    { key: 'client', label: '客户端', state: client },
    { key: 'server', label: '服务器', state: server },
  ];

  const disabledReason = options.find((option) => !option.state.enabled)?.state.reason;

  return (
    <div className="flex flex-col gap-1">
      <span className="battle-lite-muted-text text-xs font-semibold">{label}</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-(--app-border-strong)">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={!option.state.enabled}
            aria-pressed={value === option.key}
            title={option.state.enabled ? undefined : option.state.reason}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              value === option.key
                ? 'battle-lite-select-option-active'
                : 'battle-lite-select-option'
            } ${option.state.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            onClick={() => option.state.enabled && onChange?.(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {disabledReason && (
        <p className="battle-lite-subtle-text text-xs">{disabledReason}</p>
      )}
    </div>
  );
};
