import type { DataCard } from '@/components/admin/content-management/shared';

export const getReviewStatusBadge = (status: DataCard['review_status']) => {
  const map = {
    pending: { text: '待审查', color: 'bg-yellow-100 text-yellow-800' },
    approved: { text: '已通过', color: 'bg-green-100 text-green-800' },
    rejected: { text: '未通过', color: 'bg-red-100 text-red-800' },
  };
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${map[status].color}`}>{map[status].text}</span>;
};

export const getPublicStatusBadge = (status: DataCard['is_public']) => {
  const map = {
    '1': { text: '公开', color: 'bg-blue-100 text-blue-800' },
    '0': { text: '私有', color: 'bg-gray-100 text-gray-800' },
    '-1': { text: '封禁', color: 'bg-zinc-200 text-zinc-800 font-bold' },
  };
  const key = String(status);
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${map[key as keyof typeof map].color}`}>{map[key as keyof typeof map].text}</span>;
};
