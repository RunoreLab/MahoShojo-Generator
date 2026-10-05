import type { Metadata } from 'next';
import { preload } from 'react-dom';

import { HOME_FEATURE_CATEGORIES } from '@/config/features';
import { HomePage } from '@/components/home/HomePage';
import { getHomeFeatureAssets } from '@mahoshojo/ui-web/home';

/**
 * 首页路由。
 *
 * 预加载仍然留在 Web：`preload()` 是 React DOM 的浏览器 API，而**哪些**资源该预载由本页决定——
 * Desktop 首屏不渲染功能卡（它们在本地运行时不可用），因此没有这一步，也就没有对应的本地请求
 * （`DESK-PROD-004`）。
 */
export const metadata: Metadata = {
  title: '✨ 魔法少女生成器 ✨',
  description: 'AI驱动的魔法少女角色生成器，创建独一无二的魔法少女角色',
};

function FeatureImagePreloads() {
  for (const assetFile of getHomeFeatureAssets(
    HOME_FEATURE_CATEGORIES.flatMap((category) => [...category.features]),
  )) {
    preload(`/${assetFile}`, {
      as: 'image',
    });
  }

  return null;
}

export default function HomeRoute() {
  return (
    <>
      <FeatureImagePreloads />
      <HomePage />
    </>
  );
}
