'use client';

import type { ReactNode } from 'react';

import { BaseModal } from '@/components/shared/BaseModal';

export type ArenaRoomDialogProps = {
  readonly open: boolean;
  readonly titleId: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly widthClassName?: string;
};

export function ArenaRoomDialog({
  open,
  titleId,
  title,
  description,
  onClose,
  children,
  widthClassName = 'max-w-3xl',
}: ArenaRoomDialogProps) {
  return (
    <BaseModal
      isOpen={open}
      titleId={titleId}
      title={title}
      description={description}
      maxWidthClassName={widthClassName}
      closeOnBackdrop={false}
      closeButtonAriaLabel={`关闭${typeof title === 'string' ? title : '窗口'}`}
      closeButtonContent="关闭"
      onClose={onClose}
    >
      {children}
    </BaseModal>
  );
}
