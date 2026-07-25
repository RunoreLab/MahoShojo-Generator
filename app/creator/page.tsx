import type { Metadata } from 'next';

import { CreatorPage } from '@/components/creation/CreatorPage';
import { CREATOR_PAGE_COPY } from '@/lib/creator/page-copy';

export const metadata: Metadata = {
  title: CREATOR_PAGE_COPY.headTitle,
  description: CREATOR_PAGE_COPY.metaDescription,
};

export default function CreatorRoute() {
  return <CreatorPage />;
}
