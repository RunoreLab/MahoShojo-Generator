import React from 'react';

type Series = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

const buildTicks = (labels: string[], count = 5): Array<{ index: number; label: string }> => {
  if (labels.length <= 0) return [];
  if (labels.length <= count) {
    return labels.map((label, index) => ({ index, label }));
  }
  const lastIndex = labels.length - 1;
  const step = Math.max(1, Math.floor(lastIndex / (count - 1)));
  const ticks: Array<{ index: number; label: string }> = [];
  for (let index = 0; index <= lastIndex; index += step) {
    ticks.push({ index, label: labels[index] });
  }
  if (ticks[ticks.length - 1]?.index !== lastIndex) {
    ticks.push({ index: lastIndex, label: labels[lastIndex] });
  }
  return ticks;
};

const shortDateLabel = (value: string): string => value.slice(5);

export function LineSeriesChart(props: {
  labels: string[];
  series: Series[];
  height?: number;
}) {
  const { labels, series, height = 220 } = props;
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 28, left: 28 };
  const allValues = series.flatMap((item) => item.values);
  const maxValue = Math.max(1, ...allValues);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const ticks = buildTicks(labels);

  const getX = (index: number) => {
    if (labels.length <= 1) return padding.left;
    return padding.left + (chartWidth * index) / (labels.length - 1);
  };
  const getY = (value: number) => padding.top + chartHeight - (chartHeight * value) / maxValue;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
        <line x1={padding.left} y1={padding.top + chartHeight} x2={width - padding.right} y2={padding.top + chartHeight} stroke="#cbd5e1" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartHeight} stroke="#cbd5e1" />

        {series.map((item) => {
          const points = item.values.map((value, index) => `${getX(index)},${getY(value)}`).join(' ');
          return (
            <g key={item.key}>
              <polyline fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={points} />
              {item.values.map((value, index) => (
                <circle key={`${item.key}-${labels[index]}`} cx={getX(index)} cy={getY(value)} r="2.75" fill={item.color} />
              ))}
            </g>
          );
        })}

        {ticks.map((tick) => (
          <g key={`${tick.index}-${tick.label}`}>
            <line x1={getX(tick.index)} y1={padding.top + chartHeight} x2={getX(tick.index)} y2={padding.top + chartHeight + 5} stroke="#94a3b8" />
            <text x={getX(tick.index)} y={height - 6} textAnchor="middle" fontSize="11" fill="#64748b">
              {shortDateLabel(tick.label)}
            </text>
          </g>
        ))}

        <text x={padding.left} y={padding.top + 10} fontSize="11" fill="#64748b">
          {formatNumber(maxValue)}
        </text>
      </svg>

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {series.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StackedBarChart(props: {
  labels: string[];
  series: Series[];
  height?: number;
}) {
  const { labels, series, height = 220 } = props;
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 28, left: 28 };
  const totals = labels.map((_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0));
  const maxValue = Math.max(1, ...totals);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const ticks = buildTicks(labels);
  const barWidth = Math.max(6, chartWidth / Math.max(labels.length * 1.7, 1));

  const getX = (index: number) => padding.left + (chartWidth * index) / Math.max(labels.length, 1) + barWidth * 0.2;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
        <line x1={padding.left} y1={padding.top + chartHeight} x2={width - padding.right} y2={padding.top + chartHeight} stroke="#cbd5e1" />
        {labels.map((label, index) => {
          let consumed = 0;
          return (
            <g key={label}>
              {series.map((item) => {
                const value = item.values[index] ?? 0;
                const rectHeight = (chartHeight * value) / maxValue;
                const y = padding.top + chartHeight - rectHeight - consumed;
                consumed += rectHeight;
                return (
                  <rect
                    key={`${label}-${item.key}`}
                    x={getX(index)}
                    y={y}
                    width={barWidth}
                    height={Math.max(rectHeight, value > 0 ? 2 : 0)}
                    rx="2"
                    fill={item.color}
                  />
                );
              })}
            </g>
          );
        })}

        {ticks.map((tick) => (
          <text key={`${tick.index}-${tick.label}`} x={getX(tick.index) + barWidth / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="#64748b">
            {shortDateLabel(tick.label)}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {series.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBarList(props: {
  items: Array<{ key: string; label: string; value: number; note?: string; color: string }>;
}) {
  const maxValue = Math.max(1, ...props.items.map((item) => item.value));
  return (
    <div className="space-y-3">
      {props.items.map((item) => (
        <div key={item.key} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-700">{item.label}</span>
            <span className="text-slate-500">
              {formatNumber(item.value)}
              {item.note ? ` · ${item.note}` : ''}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div
              className="h-2.5 rounded-full transition-all"
              style={{ width: `${(item.value / maxValue) * 100}%`, backgroundColor: item.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

