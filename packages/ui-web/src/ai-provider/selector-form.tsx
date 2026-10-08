// 纯受控 AI Provider 选择器骨架（DESK-AIP-009.1）。
//
// 本组件只负责布局与字段行：供应商选择、模型选择、自填 modelId、凭据区、
// 高级生成设置、说明文案。所有取值与回调都由宿主注入——Web 由
// `useAiProviderSelection`（localStorage writer）驱动，Desktop 由
// `DesktopAiConfigStore` 驱动；选择器自身不产生任何持久化副作用。
//
// 行内标签与样式（input-group / battle-lite-* / input-field）是共源外观的
// 一部分；宿主差异（分组、动作项、凭据状态而非掩码输入等）通过各区块的
// ReactNode 槽注入，而不是另起一套近似 CSS。

import type { ReactNode } from 'react';

export interface AiProviderSelectorFormProps {
  /** 外层 `input-label`；默认「自定义 AI 能力提供商 (可选)」。 */
  label?: ReactNode;
  /** 供应商选择控件（通常为 `AiProviderCustomSelect`）。 */
  providerSelect: ReactNode;
  /**
   * 供应商选择下方的补充说明；`undefined` 渲染默认文案「更多提供商正在添加中...」，
   * `null` 不渲染。
   */
  providerFootnote?: ReactNode | null;
  /** 供应商区块追加内容（如文档链接、管理入口）。 */
  providerExtra?: ReactNode;
  /** 模型行标签；默认「选择模型」。 */
  modelLabel?: ReactNode;
  /** 模型选择控件；缺省则不渲染模型行。 */
  modelSelect?: ReactNode;
  /** 自填 modelId 区块；缺省不渲染。 */
  customModelId?: {
    /** `<input>` 元素本身（受控值与事件由宿主绑定）。 */
    input: ReactNode;
    /** 输入框下方说明；缺省不渲染。 */
    hint?: ReactNode;
    label?: ReactNode;
  };
  /**
   * 凭据区块；缺省不渲染。`content` 是宿主决定的编辑/展示控件——Web 是
   * 掩码输入框，Desktop 是「已配置/缺失/检查失败」状态与编辑入口，都不回显明文。
   */
  apiKey?: {
    content: ReactNode;
    label?: ReactNode;
    hint?: ReactNode;
    /** 存储语义说明（如「Key 只写入操作系统凭据存储」）。 */
    footnote?: ReactNode;
  };
  /** 高级生成设置区块（通常为 `AdvancedGenerationSettings`）。 */
  advancedSettings?: ReactNode;
  /**
   * accent box 底部说明；`undefined` 渲染默认「供应商 + 模型」口径文案，
   * `null` 不渲染（Desktop 按「连接 + 模型」口径注入自己的说明）。
   */
  advancedFootnote?: ReactNode | null;
  /** accent box 末尾追加内容（连接测试、模型管理等宿主区块）。 */
  children?: ReactNode;
}

export const AiProviderSelectorForm = ({
  label = '自定义 AI 能力提供商 (可选)',
  providerSelect,
  providerFootnote,
  providerExtra,
  modelLabel = '选择模型',
  modelSelect,
  customModelId,
  apiKey,
  advancedSettings,
  advancedFootnote,
  children,
}: AiProviderSelectorFormProps) => (
  <div className="input-group">
    <label className="input-label">{label}</label>
    {providerSelect}
    {providerFootnote === null ? null : (
      <label className="battle-lite-subtle-text text-xs">
        {providerFootnote ?? '更多提供商正在添加中...'}
      </label>
    )}
    {providerExtra}

    <div className="battle-lite-accent-box mt-3 space-y-3 rounded-lg p-3 text-sm">
      {modelSelect && (
        <div>
          <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">
            {modelLabel}
          </label>
          {modelSelect}
        </div>
      )}

      {customModelId && (
        <div>
          <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">
            {customModelId.label ?? '自定义 modelId'}
          </label>
          {customModelId.input}
          {customModelId.hint !== undefined && customModelId.hint !== null && (
            <p className="battle-lite-subtle-text mt-1 text-xs">{customModelId.hint}</p>
          )}
        </div>
      )}

      {apiKey && (
        <div>
          <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">
            {apiKey.label ?? 'API Key'}
          </label>
          {apiKey.content}
          {apiKey.hint !== undefined && apiKey.hint !== null && (
            <p className="battle-lite-subtle-text mt-1 text-xs">{apiKey.hint}</p>
          )}
          {apiKey.footnote !== undefined && apiKey.footnote !== null && (
            <p className="battle-lite-subtle-text mt-1 text-xs">{apiKey.footnote}</p>
          )}
        </div>
      )}

      {advancedSettings}

      {children}

      {advancedFootnote === null ? null : (
        <p className="battle-lite-subtle-text mt-1 text-xs">
          {advancedFootnote ?? '高级设置按「供应商 + 模型」分别保存；留空表示跟随模型 / 供应商默认。'}
        </p>
      )}
    </div>
  </div>
);
