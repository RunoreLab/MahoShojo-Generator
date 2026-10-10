'use client';
import Link from 'next/link';
import { ScenarioPickerPanel as SharedScenarioPickerPanel, type ScenarioPickerPanelProps } from '@mahoshojo/ui-web/arena';
export type { ScenarioPickerPanelProps } from '@mahoshojo/ui-web/arena';
export function ScenarioPickerPanel(props: ScenarioPickerPanelProps) {
  return <SharedScenarioPickerPanel {...props} loginLink={<Link href="/character-manager" className="battle-lite-link underline">登录后可访问私有数据卡</Link>} />;
}
