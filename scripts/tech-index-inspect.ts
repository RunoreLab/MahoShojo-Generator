#!/usr/bin/env bun

import { loadEnvConfig } from '@next/env';

import { queryFromD1 } from '@/lib/database/core';
import { computeTechIndex } from '@/lib/metrics/techIndex';

type D1RowsResult<T> = {
  result?: Array<{ results?: T[] }>;
};

const readSingleRow = <T,>(result: unknown): T | null => {
  const row = (result as D1RowsResult<T>)?.result?.[0]?.results?.[0];
  return row ? (row as T) : null;
};

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, rawValue] = token.split('=', 2);
    if (rawValue != null) {
      args.set(key, rawValue);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i += 1;
      continue;
    }
    args.set(key, '1');
  }

  const id = (args.get('--id') ?? '').trim();
  if (!id) throw new Error('缺少参数：--id <dataCardId>');

  return { id };
};

async function main() {
  loadEnvConfig(process.cwd(), true);

  const { id } = parseArgs(process.argv.slice(2));

  const row = readSingleRow<{
    id: string;
    name: string | null;
    type: string;
    data: string;
    updated_at: string;
  }>(
    await queryFromD1(
      `SELECT id, name, type, data, updated_at
       FROM data_cards
       WHERE id = ?
         AND deleted_at IS NULL`,
      [id],
    ),
  );

  if (!row) {
    console.error('未找到数据卡:', id);
    process.exit(2);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.data) as unknown;
  } catch (error) {
    console.error('data 不是有效 JSON:', { id, error });
    process.exit(3);
  }

  const tech = computeTechIndex(parsed);
  const output = {
    id: row.id,
    name: row.name ?? null,
    type: row.type,
    updatedAt: row.updated_at,
    techScore: tech.techScore,
    techLevel: tech.techLevel,
    raw: tech.raw,
    derived: tech.derived,
    components: tech.components,
    notes: tech.notes,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error('[tech-index-inspect] 脚本执行失败:', error);
  process.exit(1);
});

