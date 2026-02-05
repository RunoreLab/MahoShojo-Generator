import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { SeasonArchiveV2, SeasonArchiveV3 } from '../lib/seasons';

const readJson = (path: string): unknown => {
  const text = readFileSync(path, 'utf-8');
  return JSON.parse(text) as unknown;
};

const writeJson = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
};

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
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
      i++;
      continue;
    }
    args.set(key, '1');
  }
  return args;
};

const clampNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const migrateSnapshot = (snapshot: any): SeasonArchiveV3['entities'][number]['queues'][keyof SeasonArchiveV3['entities'][number]['queues']] => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    rating: clampNonNegativeInt(snapshot.rating),
    games: clampNonNegativeInt(snapshot.games),
    wins: clampNonNegativeInt(snapshot.wins),
    losses: clampNonNegativeInt(snapshot.losses),
    draws: clampNonNegativeInt(snapshot.draws),
    ratingUpdatedAt: typeof snapshot.ratingUpdatedAt === 'string' ? snapshot.ratingUpdatedAt : null,
  };
};

const migrateV2ToV3 = (archive: SeasonArchiveV2): SeasonArchiveV3 => {
  const strictTotal = clampNonNegativeInt(archive.leaderboards?.strict?.total);
  const freeTotal = clampNonNegativeInt(archive.leaderboards?.free?.total);

  const entities = Array.isArray(archive.entities) ? archive.entities : [];
  const nextEntities: SeasonArchiveV3['entities'] = entities.map((entity: any) => {
    const queues = entity?.queues && typeof entity.queues === 'object' ? entity.queues : {};
    const strict = migrateSnapshot(queues.strict);
    const free = migrateSnapshot(queues.free);

    return {
      ...entity,
      tagIds: Array.isArray(entity?.tagIds) ? entity.tagIds : [],
      queues: {
        ...(strict ? { strict } : {}),
        ...(free ? { free } : {}),
      },
    };
  });

  return {
    schemaVersion: 3,
    generatedAt: typeof archive.generatedAt === 'string' ? archive.generatedAt : new Date().toISOString(),
    season: archive.season,
    snapshotPolicy: {
      mode: 'top_bottom',
      top: 100,
      bottom: 50,
    },
    totalEligible: {
      strict: strictTotal,
      free: freeTotal,
    },
    entities: nextEntities,
  };
};

const listArchiveFiles = (dir: string): string[] => {
  const abs = resolve(process.cwd(), dir);
  const entries = readdirSync(abs, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /^archive_.+\.json$/i.test(e.name))
    .map((e) => resolve(abs, e.name))
    .sort();
};

const main = () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.has('--help')) {
    console.log(`[season-archive-migrate]
用法：
  bun tsx scripts/season-archive-migrate.ts [--file <archive.json>] [--dir <dir>] [--write]

说明：
  - 用于把历史赛季归档从 schemaVersion=2 迁移到 schemaVersion=3
  - v3 仅保留 entities + 元信息（snapshotPolicy/totalEligible），移除 leaderboards
  - 默认只打印计划（dry-run）；使用 --write 才会原地覆盖写入
`);
    return;
  }

  const write = args.has('--write');
  const fileArg = args.get('--file') ?? args.get('--path') ?? null;
  const dirArg = args.get('--dir') ?? 'public/data/seasons';

  const files = fileArg ? [resolve(process.cwd(), fileArg)] : listArchiveFiles(dirArg);
  if (files.length === 0) {
    console.log('[season-archive-migrate] 未找到任何归档文件。');
    return;
  }

  for (const file of files) {
    const json = readJson(file) as any;
    const schemaVersion = json?.schemaVersion;
    if (schemaVersion === 3) {
      console.log(`[season-archive-migrate] 跳过（已是 v3）：${file}`);
      continue;
    }
    if (schemaVersion !== 2) {
      console.warn(`[season-archive-migrate] 跳过（未知 schemaVersion=${String(schemaVersion)}）：${file}`);
      continue;
    }

    const next = migrateV2ToV3(json as SeasonArchiveV2);
    if (!write) {
      console.log(`[season-archive-migrate] 将迁移：${file} -> schemaVersion=3（使用 --write 原地写入）`);
      continue;
    }

    writeJson(file, next);
    console.log(`[season-archive-migrate] 已写入：${file}`);
  }
};

main();

