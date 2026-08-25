import Link from 'next/link';
import { SearchCheck } from 'lucide-react';

import type { MessageSummaryDto } from '@/lib/messages/types';

type CrowdReviewPrompt = NonNullable<MessageSummaryDto['crowdReviewPrompt']>;

export function CrowdReviewPromptCard({ prompt }: { prompt: CrowdReviewPrompt }) {
  return (
    <section className="rounded-[32px] border border-amber-200/80 bg-[linear-gradient(135deg,_rgba(254,243,199,0.96),_rgba(255,255,255,0.96))] p-6 shadow-lg backdrop-blur dark:border-amber-400/30 dark:bg-[linear-gradient(135deg,_rgba(120,53,15,0.52),_rgba(15,23,42,0.9))]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm">
            <SearchCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-200">
              Investigation
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-slate-50">{prompt.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-slate-200">{prompt.body}</p>
          </div>
        </div>

        <Link
          href={prompt.actionUrl}
          className="inline-flex items-center justify-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500"
        >
          前往调查院
        </Link>
      </div>
    </section>
  );
}
