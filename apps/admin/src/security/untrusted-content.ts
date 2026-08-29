const HTML_TEXT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeUntrustedText = (value: string): string => value.replace(
  /[&<>"']/g,
  (character) => HTML_TEXT_ESCAPES[character] ?? '',
);

export const safeExternalHttpsUrl = (value: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
  return parsed.toString();
};
