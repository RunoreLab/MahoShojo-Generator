export type ExternalMediaKind = 'image' | 'video' | 'audio';

// 统一的可信外链域名白名单（后续可按媒体类型拆分）
const BASE_TRUSTED_MEDIA_HOSTS = [
  // 模型生图（ModelScope / LibLib 常见产物域）
  'modelscope.cn',
  'liblibai.cloud',
  'liblib.art',
  'liblib.ai',
  'liblib.cloud',
  // 常见对象存储 CDN（用于生图结果直链）
  'aliyuncs.com',
  'alicdn.com',
  // 知乎
  'zhihu.com',
  'zhimg.com',
  // 微信 / QQ
  'weixin.qq.com',
  'wechat.com',
  'qq.com',
  'qpic.cn',
  'qlogo.cn',
  'wx.qlogo.cn',
  'mmbiz.qpic.cn',
  // 百度
  'baidu.com',
  'bdimg.com',
  'bdimg.cn',
  'bdstatic.com',
  // 微博
  'weibo.com',
  'sinaimg.cn',
  // 哔哩哔哩
  'bilibili.com',
  'hdslb.com',
  'biliimg.com',
  'bilivideo.com',
  // 图床
  'pnglog.com',
  'imgs.moe',
  'imgur.com',
  'i.imgur.com',
  'imgchr.com',
  's41.ax1x.com',
  // 托管
  'i.imgs.ovh',
  'imgloc.com'
] as const;

const VIDEO_TRUSTED_MEDIA_HOSTS = [
  // 优酷
  'youku.com',
  'ykimg.com',
  'valipl.cp31.ott.cibntv.net',
  // 爱奇艺
  'iqiyi.com',
  'qiyi.com',
  'iqiyipic.com',
  'qiyipic.com',
  // 哔哩哔哩短链
  'b23.tv',
  // 微博视频 CDN
  'weibocdn.com',
  // 知乎
  'vdn3.vzuu.com',
] as const;

const AUDIO_TRUSTED_MEDIA_HOSTS = [
  // QQ 音乐
  'qqmusic.qq.com',
  'y.qq.com',
  // 网易云音乐
  'music.163.com',
  'music.126.net',
  // 酷狗音乐
  'kugou.com',
  'kugou.cn',
  // 酷我音乐
  'kuwo.cn',
  'kuwo.com',
  // 咪咕音乐
  'migu.cn',
  'music.migu.cn',
  // 喜马拉雅
  'ximalaya.com',
  'xmcdn.com',
  // 音乐资源站
  '2t58.com',
  'er-sycdn.kuwo.cn',
  // Cloudflare R2 公共访问域名
  'r2.dev',
  'r2.cloudflarestorage.com',
] as const;

const AUDIO_FILE_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac'] as const;

const VIDEO_FILE_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.mov', '.m4v', '.mkv', '.flv', '.f4v', '.avi', '.m3u8'] as const;

const MEDIA_HOST_WHITELIST: Record<ExternalMediaKind, readonly string[]> = {
  image: BASE_TRUSTED_MEDIA_HOSTS,
  video: [...BASE_TRUSTED_MEDIA_HOSTS, ...VIDEO_TRUSTED_MEDIA_HOSTS],
  audio: [...BASE_TRUSTED_MEDIA_HOSTS, ...AUDIO_TRUSTED_MEDIA_HOSTS],
};

const isHostnameAllowed = (hostname: string, allowlist: readonly string[]) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return allowlist.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
};

const hasScheme = (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value);
const isHttpScheme = (value: string) => /^https?:/i.test(value);
const isExternalHttp = (value: string) => /^https?:\/\//i.test(value) || value.startsWith('//');

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
  if (!isHostnameAllowed(url.hostname, [NETEASE_MUSIC_HOST])) return null;
  if (url.pathname !== NETEASE_OUTCHAIN_PLAYER_PATH) return null;
  const playerType = (url.searchParams.get('type') ?? '').trim();
  if (playerType !== '2') return null;
  return normalizeNeteaseSongId(url.searchParams.get('id'));
};

const getNeteaseSongIdFromOuterUrl = (url: URL) => {
  if (!isHostnameAllowed(url.hostname, [NETEASE_MUSIC_HOST])) return null;
  if (url.pathname !== NETEASE_OUTER_AUDIO_PATH) return null;
  return normalizeNeteaseSongId(url.searchParams.get('id'));
};

const buildNeteaseOuterAudioUrl = (songId: string) => `https://${NETEASE_MUSIC_HOST}${NETEASE_OUTER_AUDIO_PATH}?id=${songId}.mp3`;

export const isAllowedExternalMediaUrl = (value: string | null | undefined, kind: ExternalMediaKind = 'image') => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  // 仅允许 http/https 或相对路径，其他协议一律拒绝
  if (hasScheme(trimmed) && !isHttpScheme(trimmed)) {
    return false;
  }

  if (!isExternalHttp(trimmed)) {
    return true;
  }

  try {
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isHostnameAllowed(url.hostname, MEDIA_HOST_WHITELIST[kind]);
  } catch {
    return false;
  }
};

export const resolveExternalMediaUrl = (value: string | null | undefined, kind: ExternalMediaKind = 'image') => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (!isExternalHttp(trimmed)) {
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
    if (url.protocol === 'http:' && isHostnameAllowed(url.hostname, MEDIA_HOST_WHITELIST[kind])) {
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

  if (!isExternalHttp(normalized)) {
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

export const formatMarkdownImage = (
  altText: string | null | undefined,
  src: string | null | undefined,
  title: string | null | undefined
) => {
  const alt = typeof altText === 'string' ? altText : '';
  const url = typeof src === 'string' ? src : '';
  const titlePart = typeof title === 'string' && title ? ` "${title}"` : '';
  return `![${alt}](${url}${titlePart})`;
};

export const formatMarkdownLink = (
  text: string | null | undefined,
  href: string | null | undefined,
  title: string | null | undefined
) => {
  const label = typeof text === 'string' ? text : '';
  const url = typeof href === 'string' ? href : '';
  const titlePart = typeof title === 'string' && title ? ` "${title}"` : '';
  return `[${label}](${url}${titlePart})`;
};
