import type { ReactNode } from 'react';

export interface MagicalGirlResultData {
  codename: string;
  appearance: {
    outfit: string;
    accessories: string;
    colorScheme: string;
    overallLook: string;
  };
  magicConstruct: {
    name: string;
    form: string | object;
    basicAbilities: Array<string | Record<string, unknown>> | string;
    description: string;
  };
  wonderlandRule: {
    name: string;
    description: string;
    tendency: string;
    activation: string;
  };
  blooming: {
    name: string | object;
    evolvedAbilities: string[] | string;
    evolvedForm: string;
    evolvedOutfit: string;
    powerLevel: string;
  };
  analysis: {
    personalityAnalysis: string;
    abilityReasoning: string;
    coreTraits: string[] | string;
    predictionBasis: string;
    background?: {
      belief: string;
      bonds: string;
    };
  };
}

export interface MagicalGirlResultBodyProps {
  magicalGirl: MagicalGirlResultData;
  /** Markdown policy belongs to the host. Desktop can use the shared safe renderer. */
  renderMarkdown?: (content: string) => ReactNode;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const renderInlineValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(renderInlineValue).filter(Boolean).join('，');
  if (isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[复杂数据]';
    }
  }
  return String(value);
};

const isMarkdownLike = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\n')) return true;
  return (
    /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(trimmed)
    || /`/.test(trimmed)
    || /\$\$?/.test(trimmed)
    || /!\[[^\]]*\]\([^)]+\)/.test(trimmed)
    || /\[[^\]]+\]\([^)]+\)/.test(trimmed)
    || /(\*\*|__|~~)/.test(trimmed)
    || /<(audio|video|img)\b/i.test(trimmed)
  );
};

function InlineField({
  label,
  content,
  renderMarkdown,
}: {
  label: string;
  content: unknown;
  renderMarkdown?: (content: string) => ReactNode;
}) {
  const normalized = renderInlineValue(content);
  const shouldRenderMarkdown = isMarkdownLike(normalized) && renderMarkdown;
  return (
    <div className="leading-relaxed">
      <span className="font-semibold">{label}：</span>
      {shouldRenderMarkdown ? (
        <div className="mt-1">{renderMarkdown(normalized)}</div>
      ) : (
        <span className="whitespace-pre-wrap break-words">{normalized}</span>
      )}
    </div>
  );
}

function renderComplexValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (isPlainObject(value)) {
    return (
      <div style={{ marginTop: '0.25rem', paddingLeft: '0.5rem' }}>
        {Object.entries(value).map(([key, entry]) => (
          <div key={key}><strong>{key}：</strong>{String(entry)}</div>
        ))}
      </div>
    );
  }
  return String(value);
}

function renderAbilityItem(
  ability: string | Record<string, unknown>,
  index: number,
) {
  if (typeof ability === 'string') return <li key={`basicAbility-${index}`}>• {ability}</li>;
  if (!isPlainObject(ability)) return <li key={`basicAbility-${index}`}>• {renderInlineValue(ability)}</li>;

  const { name, description, subFields, ...rest } = ability;
  const hasName = typeof name === 'string' && name.trim().length > 0;
  const hasDescription = typeof description === 'string' && description.trim().length > 0;
  const subFieldEntries = isPlainObject(subFields) ? Object.entries(subFields) : [];
  const extraEntries = Object.entries(rest).filter(([, value]) => value !== undefined && value !== null);
  const hasStructuredInfo = subFieldEntries.length > 0 || extraEntries.length > 0;
  return (
    <li key={`basicAbility-${index}`} style={{ marginBottom: '0.75rem' }}>
      <div>
        <span>• </span>
        {hasName && <strong>{String(name)}</strong>}
        {hasDescription && <span>{hasName ? '：' : ''}{String(description)}</span>}
        {!hasName && !hasDescription && !hasStructuredInfo && <span>{renderInlineValue(ability)}</span>}
      </div>
      {subFieldEntries.length > 0 && (
        <ul style={{ marginLeft: '1.5rem', marginTop: '0.25rem', listStyleType: 'circle' }}>
          {subFieldEntries.map(([subKey, subValue]) => (
            <li key={`basicAbility-${index}-sub-${subKey}`} style={{ marginLeft: '1rem', listStyleType: 'circle' }}>
              <strong>{subKey}：</strong>{renderInlineValue(subValue)}
            </li>
          ))}
        </ul>
      )}
      {extraEntries.length > 0 && (
        <ul style={{ marginLeft: '1.5rem', marginTop: '0.25rem', listStyleType: 'circle' }}>
          {extraEntries.map(([extraKey, extraValue]) => (
            <li key={`basicAbility-${index}-extra-${extraKey}`} style={{ marginLeft: '1rem', listStyleType: 'circle' }}>
              <strong>{extraKey}：</strong>{renderInlineValue(extraValue)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function MagicalGirlResultBody({ magicalGirl, renderMarkdown }: MagicalGirlResultBodyProps) {
  return (
    <div className="ui-web-magical-girl-result-body">
      <div className="result-item">
        <div className="result-label">💝 魔法少女代号</div>
        <div className="result-value whitespace-pre-wrap break-words">{magicalGirl.codename}</div>
      </div>
      <div className="result-item">
        <div className="result-label">👗 魔法少女外观</div>
        <div className="result-value whitespace-pre-wrap break-words">
          <div className="space-y-2">
            <InlineField label="服装" content={magicalGirl.appearance.outfit} renderMarkdown={renderMarkdown} />
            <InlineField label="饰品" content={magicalGirl.appearance.accessories} renderMarkdown={renderMarkdown} />
            <InlineField label="配色" content={magicalGirl.appearance.colorScheme} renderMarkdown={renderMarkdown} />
            <InlineField label="整体风格" content={magicalGirl.appearance.overallLook} renderMarkdown={renderMarkdown} />
          </div>
        </div>
      </div>
      <div className="result-item">
        <div className="result-label">⚔️ 魔力构装</div>
        <div className="result-value whitespace-pre-wrap break-words">
          <div className="space-y-2">
            <InlineField label="名称" content={magicalGirl.magicConstruct.name} renderMarkdown={renderMarkdown} />
            <div className="leading-relaxed"><span className="font-semibold">形态：</span>{renderComplexValue(magicalGirl.magicConstruct.form)}</div>
          </div>
          <div className="mt-2"><strong>基本能力：</strong></div>
          {Array.isArray(magicalGirl.magicConstruct.basicAbilities) ? (
            <ul style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
              {magicalGirl.magicConstruct.basicAbilities.map((ability, index) => renderAbilityItem(ability, index))}
            </ul>
          ) : (
            <div className="mt-2 ml-2 text-sm">
              {renderMarkdown?.(renderInlineValue(magicalGirl.magicConstruct.basicAbilities)) ?? renderInlineValue(magicalGirl.magicConstruct.basicAbilities)}
            </div>
          )}
          <div className="mt-2"><InlineField label="详细描述" content={magicalGirl.magicConstruct.description} renderMarkdown={renderMarkdown} /></div>
        </div>
      </div>
      <div className="result-item">
        <div className="result-label">🌟 奇境规则</div>
        <div className="result-value whitespace-pre-wrap break-words">
          <div className="space-y-2">
            <InlineField label="规则名称" content={magicalGirl.wonderlandRule.name} renderMarkdown={renderMarkdown} />
            <InlineField label="规则描述" content={magicalGirl.wonderlandRule.description} renderMarkdown={renderMarkdown} />
            <InlineField label="规则倾向" content={magicalGirl.wonderlandRule.tendency} renderMarkdown={renderMarkdown} />
            <InlineField label="激活条件" content={magicalGirl.wonderlandRule.activation} renderMarkdown={renderMarkdown} />
          </div>
        </div>
      </div>
      <div className="result-item">
        <div className="result-label">🌸 繁开状态</div>
        <div className="result-value whitespace-pre-wrap break-words">
          <div className="leading-relaxed"><span className="font-semibold">繁开名：</span>{renderComplexValue(magicalGirl.blooming.name)}</div>
          <div className="mt-2"><strong>进化能力：</strong></div>
          <ul style={{ marginLeft: '1rem', marginTop: '0.5rem' }}>
            {Array.isArray(magicalGirl.blooming.evolvedAbilities) && magicalGirl.blooming.evolvedAbilities.map((ability, index) => <li key={index}>• {ability}</li>)}
          </ul>
          <div className="mt-2 space-y-2">
            {typeof magicalGirl.blooming.evolvedForm === 'string' ? (
              <InlineField label="进化形态" content={magicalGirl.blooming.evolvedForm} renderMarkdown={renderMarkdown} />
            ) : (
              <div className="leading-relaxed"><span className="font-semibold">进化形态：</span>{renderComplexValue(magicalGirl.blooming.evolvedForm)}</div>
            )}
            <InlineField label="进化衣装" content={magicalGirl.blooming.evolvedOutfit} renderMarkdown={renderMarkdown} />
            <InlineField label="力量等级" content={magicalGirl.blooming.powerLevel} renderMarkdown={renderMarkdown} />
          </div>
        </div>
      </div>
      <div className="result-item">
        <div className="result-label">🔮 性格分析</div>
        <div className="result-value whitespace-pre-wrap break-words">
          <div className="space-y-2">
            <InlineField label="性格分析" content={magicalGirl.analysis.personalityAnalysis} renderMarkdown={renderMarkdown} />
            <InlineField label="能力推理" content={magicalGirl.analysis.abilityReasoning} renderMarkdown={renderMarkdown} />
            <InlineField
              label="核心特征"
              content={Array.isArray(magicalGirl.analysis.coreTraits) ? magicalGirl.analysis.coreTraits.join('、') : String(magicalGirl.analysis.coreTraits ?? '')}
              renderMarkdown={renderMarkdown}
            />
            <InlineField label="预测依据" content={magicalGirl.analysis.predictionBasis} renderMarkdown={renderMarkdown} />
          </div>
        </div>
      </div>
      {magicalGirl.analysis.background && (
        <div className="result-item">
          <div className="result-label">📖 角色背景</div>
          <div className="result-value whitespace-pre-wrap break-words">
            <div className="space-y-2">
              <InlineField label="信念" content={magicalGirl.analysis.background.belief} renderMarkdown={renderMarkdown} />
              <InlineField label="羁绊" content={magicalGirl.analysis.background.bonds} renderMarkdown={renderMarkdown} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
