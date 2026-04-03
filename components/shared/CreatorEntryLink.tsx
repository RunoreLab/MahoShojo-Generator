import Link from 'next/link';

type CreatorEntryLinkProps = {
  className?: string;
  linkClassName?: string;
  prefixText?: string;
};

export function CreatorEntryLink({
  className = 'text-sm text-gray-600',
  linkClassName = 'font-semibold text-indigo-600 hover:underline',
  prefixText = '想直接创作？',
}: CreatorEntryLinkProps) {
  return (
    <p className={className}>
      {prefixText}
      {' '}
      <Link href="/creator" className={linkClassName}>
        前往创作工坊
      </Link>
    </p>
  );
}
