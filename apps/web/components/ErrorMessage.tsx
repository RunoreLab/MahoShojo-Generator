import Link from 'next/link';
import { useMemo } from 'react';

import { ErrorMessageBox } from '@mahoshojo/ui-web/details-controls';

import { getEncyclopediaHelpForError } from '@/lib/error-help';

export interface ErrorMessageProps {
  message: string;
  status?: number | null;
  className?: string;
  linkClassName?: string;
}

export function ErrorMessage({ message, status, className = 'error-message', linkClassName }: ErrorMessageProps) {
  const help = useMemo(() => getEncyclopediaHelpForError({ message, status }), [message, status]);

  return (
    <ErrorMessageBox message={message} className={className}>
      {help ? (
        <div className="mt-2 text-xs opacity-95">
          <Link
            href={`/encyclopedia/${help.slug}`}
            className={linkClassName ?? 'underline underline-offset-2 hover:opacity-100'}
          >
            查看百科：{help.title}
          </Link>
        </div>
      ) : null}
    </ErrorMessageBox>
  );
}
