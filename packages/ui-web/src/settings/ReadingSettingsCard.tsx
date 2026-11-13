import { RotateCcw } from 'lucide-react';

import {
  READING_SIZE_PERCENTAGES,
  useReadingPreferences,
  type ReadingFont,
  type ReadingLineHeight,
  type ReadingPreferenceStore,
  type ReadingSizePercent,
  type ReadingWidth,
} from '../device-preferences';
import { SettingsCard, SettingsFieldRow } from './primitives';

const SELECT_CLASS = 'ui-web-reading-select max-w-full rounded-md border border-(--app-input-border) bg-(--app-input-bg) px-3 py-2 text-sm text-(--app-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50';

/** 生产预览与真实正文消费同一 CSS 边界；不另做一份示范排版。 */
export const ReadingPreferencesPreview = () => (
  <section aria-label="阅读效果预览" className="mt-4 rounded-lg border border-(--app-border) bg-(--app-surface-60) p-4">
    <p className="mb-3 text-xs text-(--app-text-muted)">阅读效果预览</p>
    <div className="app-reading app-reading-width space-y-3 text-sm leading-relaxed text-(--app-text)">
      <h4 className="text-lg font-semibold">在星光下翻开新的一页</h4>
      <p>魔法少女沿着河岸走过，远处的灯火映在水面。你可以选择适合自己的字号、字体与行距，慢慢读完这段故事。</p>
      <p>The story continues under the stars. 0123456789</p>
      <ul className="list-disc space-y-1 pl-5"><li>标题、正文和列表一同调整。</li><li>较窄的行宽适合阅读长文。</li></ul>
    </div>
  </section>
);

export const ReadingSettingsCard = ({ store }: { store?: ReadingPreferenceStore }) => {
  const { preferences, isHydrated, saveError, setPreferences, reset } = useReadingPreferences(store);
  return (
    <SettingsCard title="阅读" description="调整正文阅读效果，保存在本机，不随账号同步。图片导出沿用当前阅读样式。"
      actions={<button type="button" onClick={reset} disabled={!isHydrated}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:opacity-50">
        <RotateCcw aria-hidden="true" className="h-3 w-3" />恢复默认阅读
      </button>}>
      <div className="divide-y divide-(--app-border)">
        <SettingsFieldRow label="阅读字号" description="只调整正文；可与桌面端整体缩放叠加。"
          control={<select aria-label="阅读字号" className={SELECT_CLASS} disabled={!isHydrated} value={preferences.sizePercent}
            onChange={(event) => setPreferences({ sizePercent: Number(event.currentTarget.value) as ReadingSizePercent })}>
            {READING_SIZE_PERCENTAGES.map((value) => <option key={value} value={value}>{value === 100 ? '原样（100%）' : `${value}%`}</option>)}
          </select>} />
        <SettingsFieldRow label="阅读字体" description="使用本机可用字体；缺失时按同类字体回退。"
          control={<select aria-label="阅读字体" className={SELECT_CLASS} disabled={!isHydrated} value={preferences.font}
            onChange={(event) => setPreferences({ font: event.currentTarget.value as ReadingFont })}>
            <option value="default">沿用当前字体</option><option value="sans">系统无衬线</option><option value="serif">系统衬线（宋体类）</option>
          </select>} />
        <SettingsFieldRow label="阅读行距"
          control={<select aria-label="阅读行距" className={SELECT_CLASS} disabled={!isHydrated} value={preferences.lineHeight}
            onChange={(event) => setPreferences({ lineHeight: event.currentTarget.value as ReadingLineHeight })}>
            <option value="default">原样</option><option value="comfortable">舒适</option><option value="relaxed">宽松</option>
          </select>} />
        <SettingsFieldRow label="阅读宽度" description="较窄仅收窄长文正文，不改变整页布局。"
          control={<select aria-label="阅读宽度" className={SELECT_CLASS} disabled={!isHydrated} value={preferences.width}
            onChange={(event) => setPreferences({ width: event.currentTarget.value as ReadingWidth })}>
            <option value="default">原样</option><option value="narrow">较窄（约 40 个汉字）</option>
          </select>} />
      </div>
      {saveError ? <p role="status" className="mt-3 text-sm text-(--app-text)">{saveError}</p> : null}
      <ReadingPreferencesPreview />
    </SettingsCard>
  );
};
