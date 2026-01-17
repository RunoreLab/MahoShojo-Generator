export type ExternalMediaKind = 'image' | 'video' | 'audio';

// 统一的可信外链域名白名单（后续可按媒体类型拆分）
const BASE_TRUSTED_MEDIA_HOSTS = [
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
  // 托管
  'i.imgs.ovh',
  'imgloc.com'
] as const;

const VIDEO_TRUSTED_MEDIA_HOSTS = [
  // 优酷
  'youku.com',
  'ykimg.com',
  // 爱奇艺
  'iqiyi.com',
  'qiyi.com',
  'iqiyipic.com',
  'qiyipic.com',
  // 哔哩哔哩短链
  'b23.tv',
  // 微博视频 CDN
  'weibocdn.com',
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

export const isLikelyAudioUrl = (value: string | null | undefined) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  const normalized = lowered.startsWith('//') ? `https:${lowered}` : lowered;
  const withoutQuery = normalized.split('?')[0]?.split('#')[0] ?? normalized;
  return AUDIO_FILE_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext));
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
