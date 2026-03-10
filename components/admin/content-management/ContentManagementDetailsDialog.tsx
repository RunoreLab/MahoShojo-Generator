import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import type { CompareCardSnapshot, DataCard } from '@/components/admin/content-management/shared';

type ContentManagementDetailsDialogProps = {
  selectedCardDetails: DataCard | null;
  isOpen: boolean;
  onClose: () => void;
  selectedCompareCard: CompareCardSnapshot | null;
  detailsPendingNotice?: string;
};

export function ContentManagementDetailsDialog(props: ContentManagementDetailsDialogProps) {
  const { selectedCardDetails, isOpen, onClose, selectedCompareCard, detailsPendingNotice } = props;

  if (!selectedCardDetails) return null;

  return (
    <DataCardDetailsModal
      isOpen={isOpen}
      onClose={onClose}
      compareCard={selectedCompareCard}
      pendingNotice={detailsPendingNotice}
      adminTagEditor
      card={{
        id: selectedCardDetails.id,
        name: selectedCardDetails.name,
        description: selectedCardDetails.description,
        type: selectedCardDetails.type,
        data: selectedCardDetails.data,
        isPublic: selectedCardDetails.is_public === 1,
        usageCount: selectedCardDetails.usage_count,
        likeCount: selectedCardDetails.like_count,
        favoriteCount: selectedCardDetails.favorite_count,
        author: selectedCardDetails.username,
        createdAt: selectedCardDetails.created_at,
        updatedAt: selectedCardDetails.updated_at,
      }}
    />
  );
}
