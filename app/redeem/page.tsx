import type { Metadata } from 'next';

import { RedeemPage } from '@/components/redeem/RedeemPage';

export const metadata: Metadata = {
  title: '兑换中心 - MahoShojo Generator',
};

export default function RedeemRoute() {
  return <RedeemPage />;
}
