export const COLOR_MODE_STORAGE_KEY = 'mahoshojo.color-mode';

export const getColorModeInitScript = (): string => `(() => {
  try {
    var stored = window.localStorage.getItem(${JSON.stringify(COLOR_MODE_STORAGE_KEY)});
    var preference = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
    document.documentElement.dataset.colorMode = resolved;
  } catch (e) {}
})();`;
