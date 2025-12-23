// D1 数据库接口 - 保留向后兼容性
// 实际实现已迁移到 lib/database 文件夹

// 重新导出核心功能
export {
  generateRandomId,
  generateUUID,
  queryFromD1,
  createWithCustomId,
  updateById,
  getRecordById,
  saveToD1
} from './database/core';

// 重新导出用户相关功能
export {
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserByAuthKey,
  verifyUserLogin,
  getUserDataCardCapacity,
  increaseUserSlotCount
} from './database/users';

// 重新导出数据卡相关功能
export {
  createDataCard,
  createDataCardWithAuthor,
  checkPublicCardNameExists,
  getUserDataCards,
  updateDataCard,
  deleteDataCard,
  getUserRecycleBinCards,
  restoreDataCard,
  pruneUserRecycleBin,
  upsertDataCardUpdate,
  getDataCardUpdate,
  deleteDataCardUpdate,
  getUserUsedSlots,
  permanentlyDeleteDataCards,
  verifyCardOwnership,
  getPublicDataCards,
  getRandomPublicCard,
  getRandomPublicCardExcluding,
  getDataCardStatsByIds,
  getDataCardById,
  incrementDataCardLike,
  incrementDataCardUsage
} from './database/data-cards';

// 重新导出收藏相关功能
export {
  addFavorite,
  removeFavorite,
  getUserFavorites,
  getUserFavoriteIds
} from './database/favorites';

// 重新导出卡组相关功能
export {
  countUserDecks,
  createDeck,
  getUserDecks,
  getPublicDecks,
  getDeckById,
  updateDeck,
  deleteDeck,
  incrementDeckLike,
  isDeckBanned,
  getDeckStatus,
} from './database/decks';

export {
  getDeckCardsWithAccess,
  addCardsToDeck,
  removeCardsFromDeck,
  pruneDeckInaccessibleCards,
} from './database/deck-cards';

export {
  addDeckFavorite,
  removeDeckFavorite,
  getUserDeckFavorites,
  getUserDeckFavoriteIds
} from './database/deck-favorites';

// 重新导出竞技场相关功能
export {
  getOrCreateCharacter,
  updateCharacterStats,
  recordBattle,
  getCharacterLeaderboard,
  getRecentBattles
} from './database/arena';

// 重新导出 PVP 相关功能
export {
  createPvpRoom,
  getPvpRoomById,
  getPvpRoomBrowseRows,
  getPvpRoomPlayers,
  getPvpRoomMembers,
  addPvpRoomPlayer,
  removePvpRoomPlayer,
  updatePvpRoomMember,
  updatePvpRoomCas,
  upsertPvpRoomSubmission,
  getPvpRoomSubmissions,
  deletePvpRoomSubmission,
  getPvpEligibleDataCard,
  getPvpEligibleScenarioDataCard,
  clearPvpRoomMatchState,
  clearPvpRoomRuntimeState,
  upsertPvpRoomHand,
  deletePvpRoomHand,
  getPvpRoomHands,
  createPvpCardSnapshot,
  getPvpCardSnapshots,
  createPvpRound,
  getPvpRoundById,
  getLatestPvpRoundByRoom,
  getLatestPvpRoundByMatch,
  getPvpRoundsByRoom,
  getPvpRoundsByMatch,
  updatePvpRound,
  upsertPvpRoundChoice,
  getPvpRoundChoices,
  getPvpCardSnapshotById,
  createPvpMatch,
  createPvpMatchPlayers,
  updatePvpMatch,
  getPvpMatchById,
  getPvpMatchesByUserId,
  getPvpUserSummariesByUserIds,
  type PvpMatchPlayerRow,
  type PvpUserSummaryRow,
  type PvpMatchRow,
  type PvpMatchStatus,
  type PvpRoomPhase,
  type PvpRoomStatus,
  type PvpRoomMemberRole,
  type PvpRoundStatus,
  type PvpRoomRow,
  type PvpRoomBrowseRow,
  type PvpRoomPlayerRow,
  type PvpRoundRow,
} from './database/pvp';

// 重新导出战报生成记录相关功能
export {
  createBattleReportGenerationRecord,
  updateBattleReportGenerationExtraJson,
  updateBattleReportGenerationCombatantsWriteResult,
  getBattleReportGenerationByIdLite,
  getBattleReportGenerationsByUserIdLite,
  type BattleReportGenerationInsert,
  type BattleReportGenerationStatus,
  type BattleReportGenerationRowLite
} from './database/battle-report-generations';

export {
  createBattleReportGenerationCombatants,
  getBattleReportGenerationCombatantsByGenerationId,
  type BattleReportGenerationCombatantInsert,
  type BattleReportGenerationCombatantRow,
} from './database/battle-report-generation-combatants';

// 重新导出徽章相关功能
export {
  getUserBadges,
  getUserEquippedBadges,
  updateEquippedBadges,
  grantBadgeToUser,
  revokeBadgeFromUser,
  userHasBadge,
  getAllBadges
} from './database/badges';

/*
数据库 Schema 说明：
请查看 lib/database/schema.sql 文件了解完整的数据库结构。

使用说明：
1. 所有数据库相关功能已模块化到 lib/database 文件夹
2. core.ts - 核心数据库连接和基础查询功能
3. users.ts - 用户系统相关功能
4. data-cards.ts - 数据卡管理相关功能
5. arena.ts - 竞技场战斗系统相关功能
6. schema.sql - 完整的数据库 Schema 定义

此文件保留是为了向后兼容性，建议新代码直接从 lib/database 导入所需功能。
*/
