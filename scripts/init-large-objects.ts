import { loadEnvConfig } from '@next/env';

import { getRuntimeD1Client } from '@/lib/db/drizzle';

const run = async () => {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  const d1 = getRuntimeD1Client();
  if (!d1) {
    throw new Error('缺少可用 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
  }

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
    await d1.prepare(sql).run();
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

