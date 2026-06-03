import type { Metadata } from 'next';

import { MessagesPage } from '@/components/messages/MessagesPage';

export const metadata: Metadata = {
  title: '消息中心 - MahoShojo Generator',
  description: '查看全站通知与个人消息',
};

export default function MessagesRoute() {
  return <MessagesPage />;
}
