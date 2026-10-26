import { useState } from 'react';
import { FileText } from 'lucide-react';
import { SettingsCard } from '@mahoshojo/ui-web/settings';

const SOURCES = [
  { title: '界面及共享依赖许可', path: '/THIRD_PARTY_NOTICES.txt' },
  { title: '原生运行时依赖许可', path: '/RUST_THIRD_PARTY_NOTICES.txt' },
] as const;

function Notice({ title, path }: typeof SOURCES[number]) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    if (loading || text !== null) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(path);
      // Development servers can return the app shell for an absent static asset.
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('not available');
      setText(await response.text());
    } catch {
      setError('当前构建未提供这份许可文件；开发构建可先生成许可材料，正式安装包应包含该文件。');
    } finally { setLoading(false); }
  };
  return (
    <details className="rounded-md border border-(--app-border) p-3" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
      <summary className="cursor-pointer text-sm font-medium text-(--app-text)"><FileText size={16} className="mr-2 inline" aria-hidden="true" />{title}</summary>
      {loading && <p role="status" className="mt-2 text-sm">正在读取…</p>}
      {error && <p role="status" className="mt-2 text-sm text-(--app-text-muted)">{error}</p>}
      {text !== null && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-(--app-text-muted)">{text}</pre>}
    </details>
  );
}

export function ThirdPartyNoticesCard() {
  return <SettingsCard title="第三方开源许可" description="本安装包使用的开源组件与归属说明，可离线阅读。">
    <div className="space-y-3">{SOURCES.map((source) => <Notice key={source.path} {...source} />)}</div>
  </SettingsCard>;
}
