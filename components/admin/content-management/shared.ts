export interface DataCard {
  id: string;
  name: string;
  description: string;
  data: string;
  type: 'character' | 'scenario' | 'history' | 'questionnaire';
  is_public: -1 | 0 | 1;
  review_status: 'pending' | 'approved' | 'rejected';
  username: string;
  like_count: number;
  usage_count: number;
  favorite_count: number;
  is_recommended: number;
  created_at: string;
  updated_at: string;
  pending_update_id?: string | null;
  pending_update_name?: string | null;
  pending_update_description?: string | null;
  pending_update_data?: string | null;
  pending_update_created_at?: string | null;
  size_bytes?: number | null;
  size_chars?: number | null;
  metrics_stale?: number | null;
  has_visual_assets?: number | null;
}

export interface AiTargetSnapshotItem {
  kind: 'card' | 'update';
  cardId: string;
  updateId?: string;
  name: string;
  description: string;
  data: string;
  originalName?: string;
  originalDescription?: string;
  originalData?: string;
}

export interface AiReviewResult {
  id: string;
  name: string;
  suggestion: 'approved' | 'rejected';
  reason: string;
}

export type CompareCardSnapshot = {
  name: string;
  description: string;
  data: string;
  updatedAt?: string;
};

export type ContentManagementFilters = {
  page: number;
  limit: number;
  search: string;
  reviewStatus: string;
  isPublic: string;
  type: string;
  isRecommended: string;
  hasPendingUpdate: string;
  metricsState: string;
  hasVisualAssets: string;
  sizeBucket: string;
};

export const DEFAULT_CONTENT_MANAGEMENT_FILTERS: ContentManagementFilters = {
  page: 1,
  limit: 20,
  search: '',
  reviewStatus: '',
  isPublic: '',
  type: '',
  isRecommended: '',
  hasPendingUpdate: '',
  metricsState: '',
  hasVisualAssets: '',
  sizeBucket: '',
};
