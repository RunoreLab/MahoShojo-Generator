import type { ReactNode, Ref } from 'react';

import { ScenarioMarkdownPreview } from './ScenarioMarkdownPreview';

export interface GeneralScenarioCardProps {
  readonly scenario: {
    readonly title: string;
    readonly content: string;
  };
  readonly isStreaming?: boolean;
  readonly cardRef?: Ref<HTMLDivElement>;
  readonly renderMarkdown?: (content: string) => ReactNode;
  readonly saveButton?: ReactNode;
}

/** 通用情景卡的共源视觉壳；截图与 Markdown 宿主策略通过插槽注入。 */
export function GeneralScenarioCard({
  scenario,
  isStreaming = false,
  cardRef,
  renderMarkdown,
  saveButton,
}: GeneralScenarioCardProps) {
  const displayContent =
    scenario?.content?.trim()
      ? scenario.content.trim()
      : isStreaming
        ? '正在启动流式生成…'
        : '（content 字段为空，建议补充完整的情景设定，包括背景、事件、氛围。）';

  return (
    <div
      ref={cardRef}
      className="result-card"
      style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%)' }}
    >
      <div className="result-content">
        <div className="flex justify-center">
          <img src="/scenario-mode.svg" alt="通用情景档案" className="w-72 mb-4" />
        </div>

        <div className="result-item">
          <div className="result-label">情景名称</div>
          <div className="result-value text-2xl font-bold text-white drop-shadow" style={{ letterSpacing: '0.08em' }}>
            {scenario?.title || '未命名情景'}
          </div>
        </div>

        <div className="result-item">
          <div className="result-label">情景设定</div>
          <div className="result-value text-sm">
            <ScenarioMarkdownPreview key={JSON.stringify(scenario)} content={displayContent} variant="dark" renderMarkdown={renderMarkdown} />
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-white/70 animate-pulse align-middle ml-1" />
            )}
          </div>
        </div>

        {saveButton}

        <div
          className="logo-placeholder"
          style={{ display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '1rem' }}
        >
          <img
            src="/logo-white-qrcode.svg"
            alt="魔法少女"
            className="w-32 opacity-80"
          />
        </div>
      </div>
    </div>
  );
}
