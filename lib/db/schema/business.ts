import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';
export type DataCardReviewStatus = 'pending' | 'approved' | 'rejected';
export type ArenaRatingEntityType = 'data_card' | 'preset';
export type ArenaRatingQueue = 'strict' | 'free';
export type ArenaRatingEventStatus = 'pending' | 'applied' | 'skipped' | 'failed';

/**
 * 业务主用户表（映射现有 users）
 * 注意：阶段 A 仅声明迁移所需核心字段，避免一次性覆盖所有历史列。
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  email: text('email').notNull(),
  authKey: text('auth_key'),
  prefix: text('prefix'),
  isBanned: text('is_banned'),
  isAdmin: integer('is_admin', { mode: 'boolean' }),
  isReviewExempt: integer('is_review_exempt', { mode: 'boolean' }),
});

export const dataCards = sqliteTable('data_cards', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: text('type').$type<DataCardType>().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  data: text('data').notNull(),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull(),
  publicSince: text('public_since'),
  usageCount: integer('usage_count'),
  likeCount: integer('like_count'),
  favoriteCount: integer('favorite_count'),
  reviewStatus: text('review_status').$type<DataCardReviewStatus | null>(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
});

export const favorites = sqliteTable(
  'favorites',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dataCardId: text('data_card_id')
      .notNull()
      .references(() => dataCards.id, { onDelete: 'cascade' }),
    createdAt: text('created_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.dataCardId] }),
    dataCardIdIndex: index('idx_favorites_data_card_id').on(table.dataCardId),
  }),
);

export const decks = sqliteTable(
  'decks',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: integer('is_public').notNull(),
    likeCount: integer('like_count'),
    favoriteCount: integer('favorite_count'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (table) => ({
    userIdIndex: index('idx_decks_user_id').on(table.userId),
    isPublicIndex: index('idx_decks_is_public').on(table.isPublic),
    likeCountIndex: index('idx_decks_like_count').on(table.likeCount),
    favoriteCountIndex: index('idx_decks_favorite_count').on(table.favoriteCount),
  }),
);

export const deckCards = sqliteTable(
  'deck_cards',
  {
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    dataCardId: text('data_card_id').notNull(),
    cardNameSnapshot: text('card_name_snapshot'),
    cardTypeSnapshot: text('card_type_snapshot'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.deckId, table.dataCardId] }),
    deckIdIndex: index('idx_deck_cards_deck_id').on(table.deckId),
    deckIdSortOrderIndex: index('idx_deck_cards_sort_order').on(table.deckId, table.sortOrder),
  }),
);

export const deckFavorites = sqliteTable(
  'deck_favorites',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    createdAt: text('created_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.deckId] }),
    deckIdIndex: index('idx_deck_favorites_deck_id').on(table.deckId),
  }),
);

export const dataCardUpdates = sqliteTable('data_card_updates', {
  id: text('id').primaryKey(),
  dataCardId: text('data_card_id').notNull(),
  userId: integer('user_id').notNull(),
  name: text('name'),
  description: text('description'),
  data: text('data'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

export const dataCardMetrics = sqliteTable('data_card_metrics', {
  dataCardId: text('data_card_id').primaryKey(),
  techScore: integer('tech_score').notNull(),
  techLevel: text('tech_level').notNull(),
  isNative: integer('is_native', { mode: 'boolean' }),
  dataCardUpdatedAt: text('data_card_updated_at').notNull(),
  detailsJson: text('details_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dataCardTags = sqliteTable('data_card_tags', {
  dataCardId: text('data_card_id').notNull(),
  tagId: text('tag_id').notNull(),
  createdByUserId: integer('created_by_user_id'),
  createdAt: text('created_at').notNull(),
});

export const arenaRatings = sqliteTable('arena_ratings', {
  entityType: text('entity_type').$type<ArenaRatingEntityType>().notNull(),
  entityId: text('entity_id').notNull(),
  queue: text('queue').$type<ArenaRatingQueue>().notNull(),
  rating: integer('rating').notNull(),
  games: integer('games').notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  draws: integer('draws').notNull(),
  lastDelta: integer('last_delta'),
  lastAppliedAt: text('last_applied_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const arenaRatingEvents = sqliteTable('arena_rating_events', {
  id: text('id').primaryKey(),
  generationId: text('generation_id').notNull(),
  queue: text('queue').$type<ArenaRatingQueue>().notNull(),
  status: text('status').$type<ArenaRatingEventStatus>().notNull(),
  skipReason: text('skip_reason'),
  userId: integer('user_id'),
  ipAnonymized: text('ip_anonymized'),
  pairKey: text('pair_key').notNull(),
  aEntityType: text('a_entity_type').$type<ArenaRatingEntityType>().notNull(),
  aEntityId: text('a_entity_id').notNull(),
  bEntityType: text('b_entity_type').$type<ArenaRatingEntityType>().notNull(),
  bEntityId: text('b_entity_id').notNull(),
  winnerSlot: integer('winner_slot').notNull(),
  aBeforeRating: integer('a_before_rating'),
  aAfterRating: integer('a_after_rating'),
  aDelta: integer('a_delta'),
  aBeforeGames: integer('a_before_games'),
  aAfterGames: integer('a_after_games'),
  bBeforeRating: integer('b_before_rating'),
  bAfterRating: integer('b_after_rating'),
  bDelta: integer('b_delta'),
  bBeforeGames: integer('b_before_games'),
  bAfterGames: integer('b_after_games'),
  detailsJson: text('details_json'),
  createdAt: text('created_at').notNull(),
  appliedAt: text('applied_at'),
});

export const battleReportGenerations = sqliteTable('battle_report_generations', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  durationMs: integer('duration_ms').notNull(),
  status: text('status').notNull(),
  generationMode: text('generation_mode').notNull(),
  endpoint: text('endpoint').notNull(),
  ip: text('ip'),
  mode: text('mode'),
  userId: integer('user_id'),
  username: text('username'),
  userPrefix: text('user_prefix'),
  ipAnonymized: text('ip_anonymized'),
  userAgent: text('user_agent'),
  referer: text('referer'),
  acceptLanguage: text('accept_language'),
  cfRay: text('cf_ray'),
  cfCountry: text('cf_country'),
  scenarioTitle: text('scenario_title'),
  scenarioDataCardId: text('scenario_data_card_id'),
  scenarioDataCardUpdatedAt: text('scenario_data_card_updated_at'),
  language: text('language'),
  selectedLevel: text('selected_level'),
  storyLength: text('story_length'),
  hasScenario: integer('has_scenario'),
  hasUserGuidance: integer('has_user_guidance'),
  userGuidancePreview: text('user_guidance_preview'),
  hasAdjudicationEvents: integer('has_adjudication_events'),
  hasTeams: integer('has_teams'),
  readArenaHistory: integer('read_arena_history'),
  arenaHistoryReadLimit: integer('arena_history_read_limit'),
  writeArenaHistory: integer('write_arena_history'),
  readCurrentState: integer('read_current_state'),
  writeCurrentState: integer('write_current_state'),
  combatantCount: integer('combatant_count'),
  inputChars: integer('input_chars'),
  inputBytes: integer('input_bytes'),
  adjudicationEventsPreview: text('adjudication_events_preview'),
  customProviderId: text('custom_provider_id'),
  customModelId: text('custom_model_id'),
  isDowngrade: integer('is_downgrade'),
  aiProviderName: text('ai_provider_name'),
  aiProviderType: text('ai_provider_type'),
  aiModel: text('ai_model'),
  headline: text('headline'),
  winner: text('winner'),
  outputChars: integer('output_chars'),
  outputBytes: integer('output_bytes'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  cachedTokens: integer('cached_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  outputPreview: text('output_preview'),
  outputHasSensitiveWords: integer('output_has_sensitive_words'),
  outputHasShieldWords: integer('output_has_shield_words'),
  combatantsWriteOk: integer('combatants_write_ok'),
  combatantsRowCount: integer('combatants_row_count'),
  combatantsWriteError: text('combatants_write_error'),
  pvpRoomId: text('pvp_room_id'),
  pvpMatchId: text('pvp_match_id'),
  pvpRoundId: text('pvp_round_id'),
  extraJson: text('extra_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const battleReportGenerationCombatants = sqliteTable('battle_report_generation_combatants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationId: text('generation_id').notNull(),
  sortIndex: integer('sort_index').notNull(),
  name: text('name').notNull(),
  type: text('type'),
  templateId: text('template_id'),
  isNative: integer('is_native'),
  isPreset: integer('is_preset'),
  teamId: integer('team_id'),
  characterGuidance: text('character_guidance'),
  dataCardId: text('data_card_id'),
  dataCardUpdatedAt: text('data_card_updated_at'),
  sizeChars: integer('size_chars'),
  sizeBytes: integer('size_bytes'),
  createdAt: text('created_at').notNull(),
});

export const characters = sqliteTable('characters', {
  name: text('name').primaryKey(),
  isPreset: integer('is_preset', { mode: 'boolean' }).notNull(),
  wins: integer('wins').notNull(),
  losses: integer('losses').notNull(),
  participations: integer('participations').notNull(),
});

export const battles = sqliteTable('battles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  winnerName: text('winner_name').notNull(),
  participantsJson: text('participants_json').notNull(),
  createdAt: text('created_at').notNull(),
});
