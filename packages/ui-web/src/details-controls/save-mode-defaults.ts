import type {
  DetailsImageSaveMode,
  DetailsJsonSaveMode,
} from './DetailsSavePreferencesPanel';

/**
 * 「保存方式」的终端形态判定与推荐缺省（D5.1-S1-r1 / DESK-SET-007）。
 *
 * 生成页与设置页消费同一条推导：未显式选择时，移动端 UA 推荐「预览弹窗
 * 保存 / 复制原始数据」，其余终端推荐「一键下载 / 下载 JSON」。此前五份
 * 页面（Web details/canshou/creator、Desktop details/canshou）各自内联
 * 同一正则——单一来源防止设置页空态默认值与页面默认分叉。
 */

const MOBILE_UA_PATTERN =
  /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;

export const isMobileFormFactor = (): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string') {
    return false;
  }
  return MOBILE_UA_PATTERN.test(navigator.userAgent.toLowerCase());
};

export interface RecommendedSaveModes {
  imageSaveMode: DetailsImageSaveMode;
  jsonSaveMode: DetailsJsonSaveMode;
}

/**
 * 推荐缺省。`mobile` 可由已持有终端形态的调用方显式传入（避免重复探测）；
 * 缺省按当前 UA 判定。SSR/无 navigator 环境落回桌面档——与页面
 * `typeof navigator === 'undefined'` 早退一致。
 */
export const recommendedSaveModes = (
  mobile: boolean = isMobileFormFactor(),
): RecommendedSaveModes => ({
  imageSaveMode: mobile ? 'modal' : 'download',
  jsonSaveMode: mobile ? 'text' : 'download',
});
