/** 共源首页展示契约；功能清单由各宿主按实际交付范围提供。 */

export interface HomeFeature {
  readonly id: string;
  /** 相对 `content/brand/` 的资源文件名，例如 `logo.svg`。 */
  readonly assetFile: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** 产品路径。宿主据此查能力快照决定它是否可点。 */
  readonly href: string;
  readonly className?: string;
  /** 深色底上的资源需要浅色文字描边，与既有 Web 形态一致。 */
  readonly onDark?: boolean;
}

export interface HomeFeatureCategory {
  readonly id: string;
  readonly title: string;
  /** 网格列数。1 用于宽幅资源，2 用于并排的紧凑资源。 */
  readonly columns: 1 | 2;
  readonly features: readonly HomeFeature[];
}

/**
 * 宿主提供的品牌资源服务根。
 *
 * 与百科正文一样，只有 base 是宿主事实：Web 由 `public/` 提供，Desktop 由 Tauri 自定义协议伺服
 * `dist/`。两端当前都是 origin 根，但那是当前事实而不是可以写死的约定。
 */
export interface HomeAssetSource {
  readonly baseUrl: string;
}

export const homeAssetUrl = (source: HomeAssetSource, assetFile: string): string => {
  const base = source.baseUrl.endsWith('/') ? source.baseUrl.slice(0, -1) : source.baseUrl;
  return `${base}/${assetFile}`;
};

/** 返回宿主已选择渲染的功能资源。 */
export const getHomeFeatureAssets = (
  features: readonly HomeFeature[],
): readonly string[] => features.map((feature) => feature.assetFile);
