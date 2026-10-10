'use client';

import type { ComponentProps } from 'react';
import { WebPackagePickerModal as SharedWebPackagePickerModal } from '@mahoshojo/ui-web/arena';
import { webPackageViewHost } from './web-package-view-host';

export function WebPackagePickerModal(props: Omit<ComponentProps<typeof SharedWebPackagePickerModal>, 'host'>) {
  return <SharedWebPackagePickerModal {...props} host={webPackageViewHost} />;
}
