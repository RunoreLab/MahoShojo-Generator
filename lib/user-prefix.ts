import type { IconConfig } from '@/types/badge';

export type ParsedUserPrefix = {
  icon?: IconConfig;
  title: string;
  textColor: string;
  backgroundColor: string;
  borderColor?: string;
};

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isProbablyCssColor(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (HEX_COLOR_RE.test(v)) return true;
  if (v.startsWith('linear-gradient(') && v.endsWith(')')) return true;
  if (v.startsWith('radial-gradient(') && v.endsWith(')')) return true;
  return false;
}

/**
 * 解析用户头衔前缀字符串（用于展示样式）
 *
 * 新格式（推荐）: "图标配置JSON|头衔名称|文字色|背景色|边框色"
 * 示例: {"type":"lucide","name":"Crown"}|创始人|#FFD700|linear-gradient(135deg, #667eea, #764ba2)|#FFD700
 *
 * 旧格式（兼容）: "头衔名称,文字色,背景色"
 * 示例: "管理员,#FFFFFF,#FF1493"
 */
export function parseUserPrefix(prefix?: string | null): ParsedUserPrefix | null {
  if (!prefix || typeof prefix !== 'string') return null;
  const raw = prefix.trim();
  if (!raw) return null;

  if (raw.includes('|')) {
    const parts = raw.split('|').map((p) => p.trim());
    if (parts.length < 4) return null;

    const [iconPart, titlePart, textColorPart, backgroundColorPart, borderColorPart] = parts;
    const title = titlePart?.trim() ?? '';
    const textColor = textColorPart?.trim() ?? '';
    const backgroundColor = backgroundColorPart?.trim() ?? '';
    const borderColor = (borderColorPart ?? '').trim();

    if (!title) return null;
    if (!isProbablyCssColor(textColor)) return null;
    if (!isProbablyCssColor(backgroundColor)) return null;

    let icon: IconConfig | undefined;
    if (iconPart) {
      try {
        const parsed = JSON.parse(iconPart) as IconConfig;
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).type === 'string') {
          icon = parsed;
        }
      } catch {
        // ignore
      }
    }

    return {
      icon,
      title,
      textColor,
      backgroundColor,
      borderColor: borderColor && isProbablyCssColor(borderColor) && borderColor !== 'none' ? borderColor : undefined,
    };
  }

  if (raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.length !== 3) return null;

    const [title, textColor, backgroundColor] = parts;
    if (!title) return null;
    if (!isProbablyCssColor(textColor)) return null;
    if (!isProbablyCssColor(backgroundColor)) return null;

    const borderColor = HEX_COLOR_RE.test(textColor) ? `${textColor}40` : undefined;
    return {
      title,
      textColor,
      backgroundColor,
      borderColor,
    };
  }

  return null;
}

