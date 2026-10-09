import type { ReactNode } from 'react';

/** Technical view only: never parse, sanitize, truncate or substitute the source card. */
export function ScenarioJsonDetails({ data, open = false }: { data: unknown; open?: boolean }) {
  return <details open={open} className="mt-4 rounded-lg border border-(--app-border)">
    <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent)">完整 JSON（技术视图）</summary>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-(--app-border) bg-(--app-surface-strong) p-4 font-mono text-xs">{JSON.stringify(data, null, 2)}</pre>
  </details>;
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

/** Read-only projection of familiar scenario fields, not a write schema or normalization. */
export function ScenarioResultContent({ data }: { data: unknown }) {
  const card = object(data);
  const elements = object(card.elements);
  const scene = object(elements.scene);
  const rows: { label: string; content: ReactNode }[] = [];
  const addText = (label: string, value: unknown) => {
    const content = text(value);
    if (content !== null) rows.push({ label, content });
  };
  addText('情景类型', card.scenario_type);
  addText('情景简介', card.description);
  addText('时间', scene.time);
  addText('地点', scene.place);
  addText('场景特征', scene.features);
  if (Array.isArray(elements.roles)) {
    const roles = elements.roles.map(object).filter((role) => text(role.name) || text(role.description));
    if (roles.length) rows.push({ label: '登场角色', content: <ul className="space-y-2">{roles.map((role, index) => <li key={index}>{text(role.name) && <strong>{text(role.name)}</strong>}{text(role.name) && text(role.description) ? '：' : null}{text(role.description)}</li>)}</ul> });
  }
  addText('事件', elements.events);
  addText('氛围', elements.atmosphere);
  if (Array.isArray(elements.development)) {
    const development = elements.development.filter((value): value is string => text(value) !== null);
    if (development.length) rows.push({ label: '发展方向', content: <ol className="list-decimal space-y-2 pl-5">{development.map((value, index) => <li key={index}>{value}</li>)}</ol> });
  }
  return <div>
    {rows.length ? <dl aria-label="情景内容预览" className="space-y-4">{rows.map(({ label, content }) => <div key={label}>
      <dt className="mb-1 text-sm font-semibold text-(--app-text-muted)">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-(--app-text)">{content}</dd>
    </div>)}</dl> : <p className="text-sm text-(--app-text-muted)">此情景没有可展示的常用字段，请查看下方完整 JSON。</p>}
    {rows.length > 0 && <p className="mt-4 text-sm text-(--app-text-muted)">预览展示常用情景内容；扩展字段与全部原始数据保留在完整 JSON 中。</p>}
    <ScenarioJsonDetails data={data} open={rows.length === 0} />
  </div>;
}
