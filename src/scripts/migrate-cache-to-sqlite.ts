/// <reference types="node" />

import { mkdir, rename, rm } from 'fs/promises';
import { existsSync } from 'node:fs';

import { migrateLegacyJsonCacheToSqlite } from '../utils/cache';

async function main(): Promise<void> {
  const cacheDirectory = './cache';
  const backupCacheDirectory = './cache_old';

  if (existsSync(cacheDirectory)) {
    if (existsSync(backupCacheDirectory)) {
      await rm(backupCacheDirectory, { recursive: true, force: true });
    }

    await rename(cacheDirectory, backupCacheDirectory);
  }

  await mkdir(cacheDirectory, { recursive: true });

  const migrated = await migrateLegacyJsonCacheToSqlite(backupCacheDirectory);
  console.info(`Migrated ${migrated} match cache files into SQLite at ./cache/matches.db.`);
  console.info('The original JSON cache files were moved to ./cache_old and kept as a backup.');
}

void main().catch((error: unknown) => {
  console.error('Failed to migrate match cache to SQLite.', error);
  process.exitCode = 1;
});
