/**
 * 外部媒体的识别与呈现。
 *
 * ## 三件事里只有一件属于共享层
 *
 * **机制**属于这里：怎么认出音视频、怎么解析地址、怎么在不允许时降级成可见的代码文本。
 * **知识**属于宿主：哪些站点算可信音频源、地址怎么换成可播放地址。
 *
 * 因此这里没有白名单参数，只有 `ExternalMediaPolicy`；缺省策略是**拒绝一切站外媒体**。缺省值不能是
 * "允许一切"——渲染层的缺省会静默生效，那时用户看到的是一堆无法播放的代码块，而代价（本机向第三方
 * 发起请求）已经发生了。
 *
 * `detectKind` 也在策略里而不是写死按扩展名判断：Web 需要识别不以扩展名结尾的音频地址（网易云外链
 * 播放器），把它留在宿主侧就既不丢能力、也不让共享层背上某个站点的 URL 知识。
 */

export type ExternalMediaKind = 'image' | 'video' | 'audio';

export interface ExternalMediaPolicy {
  /** 判定地址的媒体种类；返回 `null` 表示按普通图片处理。 */
  readonly detectKind: (url: string) => ExternalMediaKind | null;
  /** 该地址是否允许被加载。 */
  readonly isAllowed: (url: string, kind: ExternalMediaKind) => boolean;
  /** 允许时实际用于 `src` 的地址（可能与 `url` 不同，例如经过代理或协议升级）。 */
  readonly resolve: (url: string, kind: ExternalMediaKind) => string;
}

const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:[?#]|$)/i;
const VIDEO_EXTENSION = /\.(mp4|webm|ogv|mov|mkv|avi)(?:[?#]|$)/i;

/**
 * 按扩展名判定媒体种类。
 *
 * 这是**缺省**判定，也是共享层唯一知道的规则：没有扩展名就没有可判定的依据，返回 `null` 让调用方按
 * 图片处理——那是最保守的解读，因为图片不会自动播放。
 */
export const detectMediaKindByExtension = (url: string): ExternalMediaKind | null => {
  if (AUDIO_EXTENSION.test(url)) return 'audio';
  if (VIDEO_EXTENSION.test(url)) return 'video';
  return null;
};

export const DENY_EXTERNAL_MEDIA: ExternalMediaPolicy = {
  detectKind: detectMediaKindByExtension,
  isAllowed: () => false,
  resolve: (url) => url,
};

/** 协议相对地址补全。`//host/x` 在 Markdown 里出现得很频繁，而它不是合法的可加载地址。 */
export const normalizeMarkdownHref = (href: string): string =>
  href.startsWith('//') ? `https:${href}` : href;

export const isExternalMarkdownHref = (href: string): boolean => /^https?:\/\//i.test(href);

const text = (value: string | null | undefined): string => (typeof value === 'string' ? value : '');

/**
 * 不可加载时展示的原文。
 *
 * 保留 Markdown 字面量而不是人话提示，是因为用户在读的是"这段内容引用了什么"，而不是"请检查网络"。
 * 降级文本要能让人原样复制出那个地址。
 */
export const formatMarkdownLink = (
  label: string | null | undefined,
  href: string | null | undefined,
  title?: string | null,
): string => `[${text(label)}](${text(href)}${title ? ` "${title}"` : ''})`;

export const formatMarkdownImage = (
  alt: string | null | undefined,
  src: string | null | undefined,
  title?: string | null,
): string => `![${text(alt)}](${text(src)}${title ? ` "${title}"` : ''})`;