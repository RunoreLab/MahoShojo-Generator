'use client';

import { ArenaWebPackageSection } from './ArenaWebPackageSection';
import { useSoloWebPackageSectionModel } from './useSoloWebPackageSection';

/** 单人 Arena 的 Web 包区块入口：adapter 绑定 battle store。 */
export function SoloArenaWebPackageSection({
  reportFormat,
  disabled,
  allowLocalImport = true,
}: Readonly<{
  reportFormat: 'markdown' | 'web';
  disabled?: boolean;
  /** 多人房间上下文不得把本地包展示为可发布共享配置（规格 §16.1-10）。 */
  allowLocalImport?: boolean;
}>) {
  const model = useSoloWebPackageSectionModel({ reportFormat, disabled, allowLocalImport });
  return <ArenaWebPackageSection model={model} />;
}
