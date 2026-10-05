'use client';

// 已迁入 @mahoshojo/ui-web/card-library（D5.0e 共源）；本文件保留既有签名，
// 注入浏览器本地库仓储。

import { useLocalLibraryAutoSave as useSharedLocalLibraryAutoSave } from '@mahoshojo/ui-web/card-library';
import { getLocalCardRepository } from './card-repository';

export type {
  LocalLibraryAutoSaveInput,
  LocalLibraryAutoSaveResult,
} from '@mahoshojo/ui-web/card-library';

export const useLocalLibraryAutoSave = () =>
  useSharedLocalLibraryAutoSave(getLocalCardRepository());
