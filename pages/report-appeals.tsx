import { useRouter } from 'next/router';

import ReportAppealsPage from '@/components/report-appeals/ReportAppealsPage';

export default function ReportAppealsRoute() {
  const router = useRouter();
  const reportCaseId = typeof router.query.reportCaseId === 'string' ? router.query.reportCaseId : null;
  const appealId = typeof router.query.appealId === 'string' ? router.query.appealId : null;

  return <ReportAppealsPage query={{ reportCaseId, appealId }} />;
}
