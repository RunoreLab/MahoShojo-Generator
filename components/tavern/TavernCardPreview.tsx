import { useMemo, useState } from 'react';

import type { TavernCardNormalized } from '@/lib/tavern-card';

interface CollapsibleTextProps {
  label: string;
  value?: string;
  previewChars?: number;
}

function CollapsibleText({ label, value, previewChars = 280 }: CollapsibleTextProps) {
  const [expanded, setExpanded] = useState(false);
  const text = value ?? '';
  const trimmed = text.trim();
  const isLong = trimmed.length > previewChars;
  const display = expanded || !isLong ? trimmed : `${trimmed.slice(0, previewChars)}…`;

  if (!trimmed) return null;

  return (
    <div className="mt-3 rounded-xl border border-pink-100 bg-white/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-pink-700">{label}</div>
        {isLong ? (
          <button
            type="button"
            className="text-xs text-pink-700 underline underline-offset-2 hover:opacity-80"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起' : '展开'}
          </button>
        ) : null}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{display}</div>
    </div>
  );
}

export interface TavernCardPreviewProps {
  normalized: TavernCardNormalized;
  warnings?: string[];
  className?: string;
}

export function TavernCardPreview({ normalized, warnings, className }: TavernCardPreviewProps) {
  const tagsText = useMemo(() => {
    if (!normalized.tags || normalized.tags.length === 0) return '';
    return normalized.tags.join('、');
  }, [normalized.tags]);

  return (
    <div className={`rounded-2xl border border-pink-200 bg-pink-50/40 p-4 ${className ?? ''}`}>
      <div className="flex flex-col gap-1">
        <div className="text-base font-bold text-pink-800">{normalized.name}</div>
        <div className="text-xs text-gray-700">
          {normalized.spec ? `spec=${normalized.spec}` : 'spec=—'}
          {normalized.specVersion ? ` / v=${normalized.specVersion}` : ''}
          {normalized.sourceChunk ? ` / chunk=${normalized.sourceChunk}` : ''}
        </div>
        {tagsText ? <div className="text-xs text-gray-700">标签：{tagsText}</div> : null}
      </div>

      {warnings && warnings.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">提示</div>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, idx) => (
              <li key={idx} className="whitespace-pre-wrap">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <CollapsibleText label="description" value={normalized.description} />
      <CollapsibleText label="personality" value={normalized.personality} />
      <CollapsibleText label="scenario" value={normalized.scenario} />
      <CollapsibleText label="first_mes" value={normalized.firstMes} previewChars={200} />
      <CollapsibleText label="mes_example" value={normalized.mesExample} previewChars={600} />
    </div>
  );
}
