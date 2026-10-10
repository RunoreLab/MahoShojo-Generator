'use client';

import { ArenaWebPackageSection as SharedArenaWebPackageSection, type ArenaWebPackageSectionModel } from '@mahoshojo/ui-web/arena';
import { webPackageViewHost } from './web-package-view-host';

export function ArenaWebPackageSection({ model }: Readonly<{ model: ArenaWebPackageSectionModel }>) {
  return <SharedArenaWebPackageSection model={model} host={webPackageViewHost} />;
}
