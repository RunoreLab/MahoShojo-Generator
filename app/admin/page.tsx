'use client';

import dynamic from 'next/dynamic';

const AdminDashboard = dynamic(
  () => import('@/components/creation/admin/index'),
  { ssr: false },
);

export default function AdminPage() {
  return <AdminDashboard />;
}
