import {
  isAllowedExternalMediaUrl,
  isExternalHttpUrl,
  isMediaHostnameAllowed,
  MEDIA_HOST_WHITELIST,
  type ExternalMediaKind,
} from '@mahoshojo/domain/external-media';

export type { ExternalMediaKind };

// 可信外链域名白名单已迁入共享域层（D5.0e）：@mahoshojo/domain/external-media。
// 这里保留 Web 侧剩余知识：网易云外链识别、http→https 升级、媒体种类嗅探与
// `webExternalMediaPolicy`——`isAllowedExternalMediaUrl` 本体在 domain，与问卷
// logo 准入同一口径，避免两份白名单漂移。

export { isAllowedExternalMediaUrl };

const AUDIO_FILE_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac'] as const;

const VIDEO_FILE_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mkv', '.flv', '.f4v', '.avi', '.m3u8'] as const;

const NETEASE_MUSIC_HOST = 'music.163.com';
const NETEASE_OUTCHAIN_PLAYER_PATH = '/outchain/player';
const NETEASE_OUTER_AUDIO_PATH = '/song/media/outer/url';

const normalizeNeteaseSongId = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)(?:\.mp3)?$/i);
  return match ? match[1] : null;
};

const getNeteaseSongIdFromOutchain = (url: URL) => {
  if (!isMediaHostnameAllowed(url.hostname, [NETEASE_MUSIC_HOST])) return null;
  if (url.pathname !== NETEASE_OUTCHAIN_PLAYER_PATH) return null;
  const playerType = (url.searchParams.get('type') ?? '').trim();
  if (playerType !== '2') return null;
  return normalizeNeteaseSongId(url.searchParams.get('id'));
};

const getNeteaseSongIdFromOuterUrl = (url: URL) => {
  if (!isMediaHostnameAllowed(url.hostname, [NETEASE_MUSIC_HOST])) return null;
  if (url.pathname !== NETEASE_OUTER_AUDIO_PATH) return null;
  return normalizeNeteaseSongId(url.searchParams.get('id'));
};

const buildNeteaseOuterAudioUrl = (songId: string) => `https://${NETEASE_MUSIC_HOST}${NETEASE_OUTER_AUDIO_PATH}?id=${songId}.mp3`;

export const resolveExternalMediaUrl = (value: string | null | undefined, kind: ExternalMediaKind = 'image') => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (!isExternalHttpUrl(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;

    if (kind === 'audio') {
      const songIdFromOutchain = getNeteaseSongIdFromOutchain(url);
      if (songIdFromOutchain) {
        return buildNeteaseOuterAudioUrl(songIdFromOutchain);
      }
      const songIdFromOuterUrl = getNeteaseSongIdFromOuterUrl(url);
      if (songIdFromOuterUrl) {
        return buildNeteaseOuterAudioUrl(songIdFromOuterUrl);
      }
    }

    // HTTPS 页面内播放外链媒体时，优先升级已在白名单中的 http 资源，避免 mixed content 被浏览器拦截。
    if (url.protocol === 'http:' && isMediaHostnameAllowed(url.hostname, MEDIA_HOST_WHITELIST[kind])) {
      url.protocol = 'https:';
    }

    return url.toString();
  } catch {
    return trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  }
};

export const isLikelyAudioUrl = (value: string | null | undefined) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  const normalized = lowered.startsWith('//') ? `https:${lowered}` : lowered;
  const withoutQuery = normalized.split('?')[0]?.split('#')[0] ?? normalized;
  if (AUDIO_FILE_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext))) {
    return true;
  }

  if (!isExternalHttpUrl(normalized)) {
    return false;
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (getNeteaseSongIdFromOutchain(url)) return true;
    if (getNeteaseSongIdFromOuterUrl(url)) return true;
    return false;
  } catch {
    return false;
  }
};

export const isLikelyVideoUrl = (value: string | null | undefined) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  const normalized = lowered.startsWith('//') ? `https:${lowered}` : lowered;
  const withoutQuery = normalized.split('?')[0]?.split('#')[0] ?? normalized;
  return VIDEO_FILE_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext));
};

/**
 * 纯文本格式化函数已搬到 `@mahoshojo/ui-web/markdown-text`，因为它们是渲染机制而不是 Web 策略。
 *
 * 必须走 `-text` 那个入口而不是 `@mahoshojo/ui-web/markdown`：本文件被 Route Handler
 * （`app/api/media-proxy/route.ts`）经由这条 re-export 间接导入，而 `markdown` 入口里有 React hook
 * ——Server 侧导入链上出现 hook 会被 Next 在构建期拒绝。
 *
 * 这里保留 re-export：`AnnouncementTicker`、`StreamingBattleReportCard` 与 `BattleReportCard`
 * 都从这里导入，搬迁它们的导入路径属于与 D3.0 无关的改动。
 */
export { formatMarkdownImage, formatMarkdownLink } from '@mahoshojo/ui-web/markdown-text';

/**
 * Web 的站外媒体策略。
 *
 * 三段知识都在这个对象里：怎么认出音频（网易云外链播放器不以音频扩展名结尾）、允不允许加载（域名
 * 白名单）、以及可播放地址怎么得（外链转换与 http→https 升级）。共享渲染层只消费这个形状，因此
 * Desktop 侧注入 `DENY_EXTERNAL_MEDIA` 就得到"零站外请求"的产品旅程（`DESK-PROD-004`）。
 */
export const webExternalMediaPolicy = {
  detectKind: (url: string): 'image' | 'video' | 'audio' | null => {
    if (isLikelyAudioUrl(url)) return 'audio';
    if (isLikelyVideoUrl(url)) return 'video';
    return null;
  },
  isAllowed: (url: string, kind: 'image' | 'video' | 'audio') => isAllowedExternalMediaUrl(url, kind),
  resolve: (url: string, kind: 'image' | 'video' | 'audio') => resolveExternalMediaUrl(url, kind),
};
