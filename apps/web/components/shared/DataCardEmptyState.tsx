'use client';

// 已迁入 @mahoshojo/ui-web/card-library（D5.0e 共源）；本文件保留既有导入路径，
// 「本地」空态的本地库入口链接由 Web 侧默认注入 next/link。

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { DataCardEmptyState as SharedDataCardEmptyState } from '@mahoshojo/ui-web/card-library';

export type { DataCardEmptyStateTab } from '@mahoshojo/ui-web/card-library';

const LOCAL_LIBRARY_HREF = '/encyclopedia/local-library';

export function DataCardEmptyState({
  localLibraryLink,
  ...rest
}: ComponentProps<typeof SharedDataCardEmptyState>) {
  return (
    <SharedDataCardEmptyState
      localLibraryLink={
        localLibraryLink ?? (
          <Link
            href={LOCAL_LIBRARY_HREF}
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            本地库说明
          </Link>
        )
      }
      {...rest}
    />
  );
}
