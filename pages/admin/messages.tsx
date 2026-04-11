import Head from 'next/head';

import { AdminMessagesPage } from '@/components/admin/messages/AdminMessagesPage';

export default function AdminMessagesRoute() {
  return (
    <>
      <Head>
        <title>消息管理 - Admin</title>
      </Head>
      <AdminMessagesPage />
    </>
  );
}
