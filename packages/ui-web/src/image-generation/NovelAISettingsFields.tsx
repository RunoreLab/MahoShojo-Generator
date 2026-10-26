import { useId, useState, type ReactNode } from 'react';
import { DEFAULT_NOVELAI_SETTINGS, NOVELAI_MODELS, NOVELAI_SIZES, type NovelAISettings } from '@mahoshojo/ai-core/novelai';

export interface NovelAISettingsFieldsProps {
  token: string;
  onTokenChange: (value: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onUseRecommendedPrompt?: () => void;
  settings: NovelAISettings;
  onChange: (value: NovelAISettings) => void;
  customMode: boolean;
  onCustomModeChange: (value: boolean) => void;
  disabled: boolean;
  /** 宿主装配优化器；只在展开时挂载，收起仍触发其清理/取消逻辑。 */
  promptOptimizer: ReactNode;
}

/** 受控设置表单；不读取配置/凭据存储，也不请求供应商。保留 Web 既有布局与色彩。 */
export function NovelAISettingsFields({ token, onTokenChange, prompt, onPromptChange, onUseRecommendedPrompt, settings, onChange, customMode, onCustomModeChange, disabled, promptOptimizer }: NovelAISettingsFieldsProps) {
  const id = useId();
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">NovelAI 生成设置</legend>
      <div className="input-group">
        <label htmlFor={`${id}-token`} className="input-label">NovelAI Persistent API Token</label>
        <input id={`${id}-token`} aria-label="NovelAI Persistent API Token" type="password" autoComplete="off" spellCheck={false} className="input-field"
          value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder="粘贴 Token（可带 Bearer 前缀）" />
      </div>
      <div className="input-group">
        <label htmlFor={`${id}-base-url`} className="input-label">NovelAI Base URL（可选）</label>
        <input id={`${id}-base-url`} aria-label="NovelAI Base URL（可选）" type="url" autoComplete="off" spellCheck={false} className="input-field"
          value={settings.baseUrl} onChange={(event) => onChange({ ...settings, baseUrl: event.target.value })}
          placeholder="https://image.novelai.net" aria-describedby={`${id}-base-url-help`} />
        <p id={`${id}-base-url-help`} className="mt-2 text-xs text-gray-500">留空使用官方地址。可填写兼容服务的 HTTP/HTTPS 基础地址（可含路径前缀）</p>
      </div>
      <div className="input-group">
        <label htmlFor={`${id}-model`} className="input-label">模型版本</label>
        <select id={`${id}-model`} aria-label="模型版本" className="input-field" value={settings.model}
          onChange={(event) => onChange({ ...settings, model: event.target.value })}>
          {NOVELAI_MODELS.map((model, index) => <option key={model} value={model}>{index === 0 ? 'V4.5 Curated' : 'V5 Curated'}</option>)}
        </select>
      </div>
      <div className="input-group">
        <label htmlFor={`${id}-prompt`} className="input-label">提示词</label>
        <textarea id={`${id}-prompt`} aria-label="提示词" className="input-field" rows={4} value={prompt}
          onChange={(event) => onPromptChange(event.target.value)} placeholder="填写角色、动作和场景描述，可先用下方 LLM 优化后再生成" />
        {onUseRecommendedPrompt && <div className="mt-2">
          <button type="button" onClick={onUseRecommendedPrompt}
            className="rounded-lg border border-pink-200 px-3 py-2 text-sm text-pink-700 hover:bg-pink-50">
            使用推荐提示词
          </button>
        </div>}
      </div>
      <button type="button" aria-expanded={optimizerOpen} aria-controls={`${id}-optimizer`}
        className="w-full rounded-lg border border-pink-300 bg-pink-50 px-4 py-3 text-left text-sm font-semibold text-pink-800 hover:bg-pink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500" onClick={() => setOptimizerOpen((value) => !value)}>
        {optimizerOpen ? '收起 LLM 优化提示词' : 'LLM 优化提示词（推荐，可选）'}
        <span className="mt-1 block text-xs font-normal">使用你配置的文本模型，仅请求一次，在生成时精简并适配语法、画面文字与所选 Curated 版本。</span>
      </button>
      {optimizerOpen && <div id={`${id}-optimizer`}>
        {promptOptimizer}
      </div>}
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" aria-label="自定义模式" checked={customMode} onChange={(event) => onCustomModeChange(event.target.checked)}
          aria-controls={`${id}-custom`} aria-expanded={customMode} />
        自定义模式
      </label>
      {!customMode && <p className="text-xs text-gray-500">简单模式：使用上方所选模型 · 竖图 832 × 1216 · {DEFAULT_NOVELAI_SETTINGS.steps} 步 · 强度 {DEFAULT_NOVELAI_SETTINGS.scale} · 随机种子。</p>}
      {customMode && <div id={`${id}-custom`} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-size`} className="input-label">图片尺寸</label>
            <select id={`${id}-size`} aria-label="图片尺寸" className="input-field" value={settings.size}
              onChange={(event) => onChange({ ...settings, size: event.target.value })}>
              {NOVELAI_SIZES.map((size) => <option key={size} value={size}>{size.replace('x', ' × ')}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-steps`} className="input-label">步数（1–50）</label>
            <input id={`${id}-steps`} aria-label="步数（1–50）" className="input-field" type="number" min={1} max={50} step={1} value={Number.isNaN(settings.steps) ? '' : settings.steps}
              onChange={(event) => onChange({ ...settings, steps: event.target.valueAsNumber })} />
          </div>
          <div>
            <label htmlFor={`${id}-scale`} className="input-label">提示词强度（0–10）</label>
            <input id={`${id}-scale`} aria-label="提示词强度（0–10）" className="input-field" type="number" min={0} max={10} step={0.1} value={Number.isNaN(settings.scale) ? '' : settings.scale}
              onChange={(event) => onChange({ ...settings, scale: event.target.valueAsNumber })} />
          </div>
        </div>
        <div className="input-group">
          <label htmlFor={`${id}-seed`} className="input-label">种子（留空随机）</label>
          <input id={`${id}-seed`} aria-label="种子（留空随机）" className="input-field" inputMode="numeric" value={settings.seed} placeholder="0–4294967295"
            onChange={(event) => onChange({ ...settings, seed: event.target.value })} />
        </div>
        <div className="input-group">
          <label htmlFor={`${id}-negative`} className="input-label">负面提示词（可选）</label>
          <textarea id={`${id}-negative`} aria-label="负面提示词（可选）" className="input-field" rows={3} value={settings.negativePrompt}
            onChange={(event) => onChange({ ...settings, negativePrompt: event.target.value })} />
        </div>
      </div>}
      <p className="text-xs text-gray-500">每次生成 1 张 PNG，使用 Euler Ancestral 采样。生成可能消耗账号 Anlas，具体以 NovelAI 计费为准；失败不会自动重试。</p>
    </fieldset>
  );
}
