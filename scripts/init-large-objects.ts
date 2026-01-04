import { queryFromD1 } from '@/lib/d1';

const run = async () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS large_objects (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      owner_ref_id TEXT NOT NULL,
      owner_user_id INTEGER,
      r2_key TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      stored_bytes INTEGER,
      sha256 TEXT,
      content_type TEXT,
      content_encoding TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(kind, owner_ref_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_large_objects_kind_created_at ON large_objects(kind, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_large_objects_owner_user_id_created_at ON large_objects(owner_user_id, created_at);`,
  ];

  for (const sql of statements) {
    // D1 API 一次只建议跑一条语句
    await queryFromD1(sql, []);
  }
};

run()
  .then(() => {
    console.log('✅ large_objects 初始化完成');
  })
  .catch((error) => {
    console.error('❌ large_objects 初始化失败:', error);
    process.exitCode = 1;
  });

