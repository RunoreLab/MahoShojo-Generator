import Head from 'next/head';

import { AdminReportAppealsPage } from '@/components/admin/report-appeals/AdminReportAppealsPage';

export default function AdminReportAppealsRoute() {
  return (
    <>
      <Head>
        <title>申诉复核 - Admin</title>
      </Head>
      <AdminReportAppealsPage />
    </>
  );
}
