/**
 * 站外媒体 URL 的**准入白名单**（D5.0e 自 apps/web/lib/markdown/externalMedia 迁入）。
 *
 * 分层口径与 `@mahoshojo/ui-web/markdown-text` 一致：识别/解析机制在共享渲染层，
 * 「哪些站点算可信」这条知识是产品级策略，各 runtime 同一口径——因此放在 domain。
 * Web 的 `webExternalMediaPolicy`、地址升级与网易云外链识别仍留在 Web 文件里，
 * 本模块只迁出问卷 logo 校验与 Web 策略共用的 `isAllowedExternalMediaUrl` 及其白名单。
 */

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

export const MEDIA_HOST_WHITELIST: Record<ExternalMediaKind, readonly string[]> = {
  image: BASE_TRUSTED_MEDIA_HOSTS,
  video: [...BASE_TRUSTED_MEDIA_HOSTS, ...VIDEO_TRUSTED_MEDIA_HOSTS],
  audio: [...BASE_TRUSTED_MEDIA_HOSTS, ...AUDIO_TRUSTED_MEDIA_HOSTS],
};

export const isMediaHostnameAllowed = (hostname: string, allowlist: readonly string[]) => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return allowlist.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
};

export const hasUrlScheme = (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value);
export const isHttpUrlScheme = (value: string) => /^https?:/i.test(value);
export const isExternalHttpUrl = (value: string) => /^https?:\/\//i.test(value) || value.startsWith('//');

export const isAllowedExternalMediaUrl = (value: string | null | undefined, kind: ExternalMediaKind = 'image') => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  // 仅允许 http/https 或相对路径，其他协议一律拒绝
  if (hasUrlScheme(trimmed) && !isHttpUrlScheme(trimmed)) {
    return false;
  }

  if (!isExternalHttpUrl(trimmed)) {
    return true;
  }

  try {
    const url = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isMediaHostnameAllowed(url.hostname, MEDIA_HOST_WHITELIST[kind]);
  } catch {
    return false;
  }
};
