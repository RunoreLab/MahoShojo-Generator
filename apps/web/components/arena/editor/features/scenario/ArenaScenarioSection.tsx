'use client';
import Link from 'next/link';
import { ArenaScenarioSection as SharedArenaScenarioSection, type ArenaScenarioSectionProps } from '@mahoshojo/ui-web/arena';
export function ArenaScenarioSection(props: ArenaScenarioSectionProps) {
  return <SharedArenaScenarioSection {...props}
    loginLink={<Link href="/character-manager" className="battle-lite-link underline">登录后可访问私有数据卡</Link>}
    getPresetDownloadHref={(filename) => `/scenario-presets/${encodeURIComponent(filename)}`}
  />;
}
