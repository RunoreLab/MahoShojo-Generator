import type { Metadata } from 'next';

import { QuestionnaireEditorPage } from '@/components/creation/QuestionnaireEditorPage';

export const metadata: Metadata = {
  title: '问卷编辑器',
};

export default function QuestionnaireEditorRoute() {
  return <QuestionnaireEditorPage />;
}
