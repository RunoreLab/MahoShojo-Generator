'use client';
import { PresetGridPicker as SharedPresetGridPicker, type PresetGridPickerProps } from '@mahoshojo/ui-web/arena';
import type { Preset } from '@/lib/presets';
export type { PresetGridPickerProps } from '@mahoshojo/ui-web/arena';
type GridPreset = Pick<Preset, 'filename' | 'name' | 'description'> & { type?: Preset['type'] };
export function PresetGridPicker<T extends GridPreset>(props: PresetGridPickerProps<T>) {
  return <SharedPresetGridPicker {...props} getDownloadHref={(filename) => `/presets/${encodeURIComponent(filename)}`} />;
}
