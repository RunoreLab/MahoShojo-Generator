'use client';
import { ScenarioPresetGridPicker as SharedScenarioPresetGridPicker, type ScenarioPresetGridPickerProps } from '@mahoshojo/ui-web/arena';
export type { ScenarioPresetGridPickerProps } from '@mahoshojo/ui-web/arena';
export function ScenarioPresetGridPicker(props: ScenarioPresetGridPickerProps) {
  return <SharedScenarioPresetGridPicker {...props} getDownloadHref={(filename) => `/scenario-presets/${encodeURIComponent(filename)}`} />;
}
