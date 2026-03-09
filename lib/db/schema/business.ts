import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  registrationIp: text('registration_ip'),
  prefix: text('prefix'),
  signature: text('signature'),
  avatarWebpBase64: text('avatar_webp_base64'),
  slotCount: integer('slot_count'),
  isBanned: text('is_banned'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  isReviewExempt: integer('is_review_exempt', { mode: 'boolean' }).notNull().default(false),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
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
  isRecommended: integer('is_recommended', { mode: 'boolean' }),
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

export const pvpRooms = sqliteTable(
  'pvp_rooms',
  {
    id: text('id').primaryKey(),
    hostUserId: integer('host_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    phase: text('phase').notNull(),
    rulesJson: text('rules_json').notNull(),
    currentMatchId: text('current_match_id'),
    joinCodeHash: text('join_code_hash'),
    joinCodeSalt: text('join_code_salt'),
    version: integer('version').notNull(),
    expiresAt: text('expires_at'),
    lastActivityAt: text('last_activity_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusIndex: index('idx_pvp_rooms_status').on(table.status),
    updatedAtIndex: index('idx_pvp_rooms_updated_at').on(table.updatedAt),
    currentMatchIdIndex: index('idx_pvp_rooms_current_match_id').on(table.currentMatchId),
  }),
);

export const pvpRoomPlayers = sqliteTable(
  'pvp_room_players',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    seat: integer('seat'),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] }),
    roomIdIndex: index('idx_pvp_room_players_room_id').on(table.roomId),
  }),
);

export const pvpRoomChatMessages = sqliteTable(
  'pvp_room_chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    senderUserId: integer('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderRole: text('sender_role').notNull(),
    senderUsername: text('sender_username').notNull(),
    senderPrefix: text('sender_prefix'),
    contentJson: text('content_json').notNull(),
    renderedText: text('rendered_text'),
    stickerId: text('sticker_id'),
    emojiText: text('emoji_text'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    roomIdIdIndex: index('idx_pvp_room_chat_messages_room_id_id').on(table.roomId, table.id),
    roomIdCreatedAtIndex: index('idx_pvp_room_chat_messages_room_id_created_at').on(table.roomId, table.createdAt),
    roomIdSenderUserIdIdIndex: index('idx_pvp_room_chat_messages_room_id_sender_user_id_id').on(
      table.roomId,
      table.senderUserId,
      table.id,
    ),
  }),
);

export const pvpRoomSubmissions = sqliteTable(
  'pvp_room_submissions',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    submissionJson: text('submission_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] }),
  }),
);

export const pvpRoomHands = sqliteTable(
  'pvp_room_hands',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    handJson: text('hand_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] }),
  }),
);

export const pvpRoomCardSnapshots = sqliteTable(
  'pvp_room_card_snapshots',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refJson: text('ref_json').notNull(),
    cardType: text('card_type').notNull(),
    name: text('name').notNull(),
    dataJson: text('data_json').notNull(),
    sourceUpdatedAt: text('source_updated_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    roomIdIndex: index('idx_pvp_room_card_snapshots_room_id').on(table.roomId),
  }),
);

export const pvpMatches = sqliteTable(
  'pvp_matches',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    rulesJson: text('rules_json').notNull(),
    participants: integer('participants').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    winnerUserId: integer('winner_user_id').references(() => users.id, { onDelete: 'set null' }),
    resultJson: text('result_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    roomIdIndex: index('idx_pvp_matches_room_id').on(table.roomId),
    statusIndex: index('idx_pvp_matches_status').on(table.status),
    startedAtIndex: index('idx_pvp_matches_started_at').on(table.startedAt),
  }),
);

export const pvpRounds = sqliteTable(
  'pvp_rounds',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => pvpRooms.id, { onDelete: 'cascade' }),
    matchId: text('match_id').references(() => pvpMatches.id, { onDelete: 'cascade' }),
    roundIndex: integer('round_index').notNull(),
    status: text('status').notNull(),
    battleGenerationId: text('battle_generation_id'),
    publicSnapshotJson: text('public_snapshot_json'),
    resultJson: text('result_json'),
    winnerUserId: integer('winner_user_id').references(() => users.id, { onDelete: 'set null' }),
    winnerName: text('winner_name'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    roomIdIndex: index('idx_pvp_rounds_room_id').on(table.roomId),
    matchIdIndex: index('idx_pvp_rounds_match_id').on(table.matchId),
  }),
);

export const pvpMatchPlayers = sqliteTable(
  'pvp_match_players',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => pvpMatches.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    username: text('username'),
    userPrefix: text('user_prefix'),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchId, table.userId] }),
    matchIdIndex: index('idx_pvp_match_players_match_id').on(table.matchId),
    userIdIndex: index('idx_pvp_match_players_user_id').on(table.userId),
  }),
);

export const pvpRoundChoices = sqliteTable(
  'pvp_round_choices',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => pvpRounds.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    choiceRefJson: text('choice_ref_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roundId, table.userId] }),
    roundIdIndex: index('idx_pvp_round_choices_round_id').on(table.roundId),
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
}, (table) => ({
  pk: primaryKey({ columns: [table.dataCardId, table.tagId] }),
  tagIdIndex: index('idx_data_card_tags_tag_id').on(table.tagId),
  dataCardIdIndex: index('idx_data_card_tags_data_card_id').on(table.dataCardId),
}));

export const redemptionCodes = sqliteTable('redemption_codes', {
  code: text('code').primaryKey(),
  slotCount: integer('slot_count').notNull(),
  createdAt: text('created_at'),
});

export const badges = sqliteTable('badges', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon').notNull(),
  textColor: text('text_color').notNull(),
  backgroundColor: text('background_color').notNull(),
  borderColor: text('border_color'),
  rarity: integer('rarity'),
  sortOrder: integer('sort_order'),
  isActive: integer('is_active', { mode: 'boolean' }),
  createdAt: text('created_at'),
}, (table) => ({
  rarityIndex: index('idx_badges_rarity').on(table.rarity),
  isActiveIndex: index('idx_badges_is_active').on(table.isActive),
}));

export const userBadges = sqliteTable('user_badges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  badgeId: text('badge_id').notNull(),
  isEquipped: integer('is_equipped', { mode: 'boolean' }),
  displayOrder: integer('display_order'),
  obtainedAt: text('obtained_at'),
}, (table) => ({
  userIdIndex: index('idx_user_badges_user_id').on(table.userId),
  isEquippedIndex: index('idx_user_badges_is_equipped').on(table.isEquipped),
  userIdBadgeIdUnique: uniqueIndex('user_badges_user_id_badge_id_unique').on(table.userId, table.badgeId),
}));

export type TagScope = 'user' | 'system' | 'admin';

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  scope: text('scope').$type<TagScope>().notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  scopeIndex: index('idx_tags_scope').on(table.scope),
  isActiveIndex: index('idx_tags_is_active').on(table.isActive),
  categoryIndex: index('idx_tags_category').on(table.category),
}));

export const tagAliases = sqliteTable('tag_aliases', {
  alias: text('alias').primaryKey(),
  tagId: text('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  tagIdIndex: index('idx_tag_aliases_tag_id').on(table.tagId),
}));

export const userLastActivity = sqliteTable('user_last_activity', {
  userId: integer('user_id').primaryKey(),
  lastSeenAt: text('last_seen_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  lastSeenAtIndex: index('idx_user_last_activity_last_seen_at').on(table.lastSeenAt),
}));

export const largeObjects = sqliteTable('large_objects', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  ownerRefId: text('owner_ref_id').notNull(),
  ownerUserId: integer('owner_user_id'),
  r2Key: text('r2_key').notNull(),
  bytes: integer('bytes').notNull(),
  storedBytes: integer('stored_bytes'),
  sha256: text('sha256'),
  contentType: text('content_type'),
  contentEncoding: text('content_encoding'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  kindCreatedAtIndex: index('idx_large_objects_kind_created_at').on(table.kind, table.createdAt),
  ownerUserIdCreatedAtIndex: index('idx_large_objects_owner_user_id_created_at').on(table.ownerUserId, table.createdAt),
  kindOwnerRefUnique: uniqueIndex('large_objects_kind_owner_ref_unique').on(table.kind, table.ownerRefId),
}));

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
