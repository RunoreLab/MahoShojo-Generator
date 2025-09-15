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
  getUserDataCardCapacity
} from './database/users';

// 重新导出数据卡相关功能
export {
  createDataCard,
  createDataCardWithAuthor,
  checkPublicCardNameExists,
  getUserDataCards,
  updateDataCard,
  deleteDataCard,
  verifyCardOwnership,
  getPublicDataCards,
  getDataCardById,
  incrementDataCardLike,
  incrementDataCardUsage
} from './database/data-cards';

// 重新导出竞技场相关功能
export {
  getOrCreateCharacter,
  updateCharacterStats,
  recordBattle,
  getCharacterLeaderboard,
  getRecentBattles
} from './database/arena';

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