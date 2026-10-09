import Link from 'next/link';
import { CreatorEntryLink as SharedCreatorEntryLink, type CreatorEntryLinkProps } from '@mahoshojo/ui-web/details-controls';

export function CreatorEntryLink(props: Pick<CreatorEntryLinkProps, 'className' | 'linkClassName' | 'prefixText'>) {
  return <SharedCreatorEntryLink {...props} renderLink={(link) => <Link {...link} />} />;
}
