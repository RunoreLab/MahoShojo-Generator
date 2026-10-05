'use client';

// 已迁入 @mahoshojo/ui-web/card-library（D5.0e 共源）；本文件保留既有签名，
// 注入浏览器本地库仓储。

import {
  useLocalDataCards as useSharedLocalDataCards,
  type LocalDataCardPageState,
} from '@mahoshojo/ui-web/card-library';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import { getLocalCardRepository } from './card-repository';

export type { LocalDataCardPageState };
export type { LocalDataCardRow } from '@mahoshojo/ui-web/card-library';

export const useLocalDataCards = (
  enabled: boolean,
  cardTypes: OnlineDataCardType[] | undefined,
  search: string,
): LocalDataCardPageState =>
  useSharedLocalDataCards(getLocalCardRepository(), enabled, cardTypes, search);
