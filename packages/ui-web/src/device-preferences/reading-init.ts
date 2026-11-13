/** 阅读偏好的纯契约与首屏脚本；两宿主可在无 React 的启动阶段消费。 */
export const READING_PREFERENCE_STORAGE_KEY = 'mahoshojo.reading-preferences.v1';
export const READING_SIZE_PERCENTAGES = [100, 110, 125, 150, 175, 200] as const;
export type ReadingSizePercent = (typeof READING_SIZE_PERCENTAGES)[number];
export type ReadingFont = 'default' | 'sans' | 'serif';
export type ReadingLineHeight = 'default' | 'comfortable' | 'relaxed';
export type ReadingWidth = 'default' | 'narrow';

export interface ReadingPreferences {
  readonly sizePercent: ReadingSizePercent;
  readonly font: ReadingFont;
  readonly lineHeight: ReadingLineHeight;
  readonly width: ReadingWidth;
}

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = Object.freeze({
  sizePercent: 100,
  font: 'default',
  lineHeight: 'default',
  width: 'default',
});

export const normalizeReadingPreferences = (input: unknown): ReadingPreferences => {
  const value = typeof input === 'object' && input !== null
    ? input as Record<string, unknown>
    : {};
  return {
    sizePercent: READING_SIZE_PERCENTAGES.includes(value.sizePercent as ReadingSizePercent)
      ? value.sizePercent as ReadingSizePercent : 100,
    font: value.font === 'sans' || value.font === 'serif' ? value.font : 'default',
    lineHeight: value.lineHeight === 'comfortable' || value.lineHeight === 'relaxed'
      ? value.lineHeight : 'default',
    width: value.width === 'narrow' ? 'narrow' : 'default',
  };
};

export const parseReadingPreferencesText = (text: string | null): ReadingPreferences => {
  if (text === null) return DEFAULT_READING_PREFERENCES;
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (value as Record<string, unknown>).version !== 1) {
    throw new Error('unsupported reading preferences');
  }
  return normalizeReadingPreferences(value);
};

/**
 * DOM 标记由本脚本先于首屏写入；即便设置页未挂载，其他标签页的修改也即时生效。
 * DOM 与读存储分别兜底，受限 localStorage 不阻断产品启动。
 */
export const getReadingPreferenceInitScript = (): string => `(() => {
  var key = ${JSON.stringify(READING_PREFERENCE_STORAGE_KEY)};
  var sizes = ${JSON.stringify(READING_SIZE_PERCENTAGES)};
  var apply = function () {
    var value = {};
    try {
      var parsed = JSON.parse(window.localStorage.getItem(key));
      if (parsed && !Array.isArray(parsed) && parsed.version === 1) value = parsed;
    } catch (e) {}
    try {
      var data = document.documentElement.dataset;
      data.readingSize = String(sizes.indexOf(value.sizePercent) >= 0 ? value.sizePercent : 100);
      data.readingFont = value.font === 'sans' || value.font === 'serif' ? value.font : 'default';
      data.readingLineHeight = value.lineHeight === 'comfortable' || value.lineHeight === 'relaxed' ? value.lineHeight : 'default';
      data.readingWidth = value.width === 'narrow' ? 'narrow' : 'default';
    } catch (e) {}
  };
  apply();
  window.addEventListener('storage', function (event) {
    if (event.key === key || event.key === null) apply();
  });
})();`;
