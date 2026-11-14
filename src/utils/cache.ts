import { readFile, readdir } from 'fs/promises';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';

const MATCH_CACHE_FILE_PATTERN = /^match_\d+\.json$/;
const MATCH_CACHE_DIRECTORY = './cache';
const MATCH_CACHE_DATABASE_PATH = join(MATCH_CACHE_DIRECTORY, 'matches.db');

type MatchCacheRow = {
  id: number;
  payload: string;
  match_date: number | null;
};

function parseMatchIdFromPath(path: string): number | null {
  const match = path.match(/(?:^|\/|\\)match_(\d+)(?:\.json)?$/);
  return match ? Number(match[1]) : null;
}

function resolveMatchId(path: string, data: unknown): number | null {
  const parsedPathId = parseMatchIdFromPath(path);
  if (typeof parsedPathId === 'number' && Number.isFinite(parsedPathId)) {
    return parsedPathId;
  }

  if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'number') {
    return data.id;
  }

  return null;
}

function getDatabase(): DatabaseSync {
  mkdirSync(MATCH_CACHE_DIRECTORY, { recursive: true });

  const database = new DatabaseSync(MATCH_CACHE_DATABASE_PATH);
  database.exec(`
    CREATE TABLE IF NOT EXISTS cached_matches (
      id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      match_date INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cached_matches_match_date ON cached_matches(match_date);
  `);

  return database;
}

export async function migrateLegacyJsonCacheToSqlite(cacheDirectory = MATCH_CACHE_DIRECTORY): Promise<number> {
  const files = await readdir(cacheDirectory).catch(() => []);
  const database = getDatabase();
  let migrated = 0;

  for (const file of files) {
    if (!MATCH_CACHE_FILE_PATTERN.test(file)) continue;

    const path = join(cacheDirectory, file);
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

      if (typeof parsed !== 'object' || parsed === null) continue;

      const matchId = resolveMatchId(path, parsed);
      if (matchId === null || !Number.isFinite(matchId)) continue;

      const matchDate = 'date' in parsed && typeof parsed.date === 'number' ? parsed.date : null;
      const payload = JSON.stringify(parsed);
      database
        .prepare(
          `
            INSERT INTO cached_matches (id, payload, match_date, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              payload = excluded.payload,
              match_date = excluded.match_date,
              updated_at = excluded.updated_at
          `,
        )
        .run(matchId, payload, matchDate, Date.now());

      migrated += 1;
    } catch {
      console.warn(`Skipped invalid cache entry during migration: ${file}`);
    }
  }

  return migrated;
}

export function removeExpiredMatchCache(
  id: number,
  matchDate: number,
  discoveredDuring: 'startup cleanup' | 'match lookup',
  cacheDirectory = MATCH_CACHE_DIRECTORY,
): void {
  void cacheDirectory;

  try {
    getDatabase().prepare('DELETE FROM cached_matches WHERE id = ?').run(id);
    console.info(
      `Removed expired match cache during ${discoveredDuring}: match_${id} from ${new Date(matchDate * 1000).toISOString()}`,
    );
  } catch (error) {
    if (!isErrnoWithCode(error, 'ENOENT')) throw error;
  }
}

export function isMatchOlderThanTwoMonths(matchDate: number, now = new Date()): boolean {
  if (!Number.isFinite(matchDate)) {
    return false;
  }

  const cutoff = new Date(now);
  const dayOfMonth = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 2);
  const lastDayOfCutoffMonth = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(dayOfMonth, lastDayOfCutoffMonth));

  return matchDate * 1000 < cutoff.getTime();
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function removeExpiredCachedMatches(cacheDirectory = MATCH_CACHE_DIRECTORY, now = new Date()): void {
  void cacheDirectory;

  const rows = getDatabase().prepare('SELECT id, payload FROM cached_matches').all() as MatchCacheRow[];

  for (const row of rows) {
    try {
      const match = JSON.parse(row.payload) as { date?: number };
      if (!match || typeof match.date !== 'number' || !isMatchOlderThanTwoMonths(match.date, now)) continue;
      removeExpiredMatchCache(row.id, match.date, 'startup cleanup');
    } catch {
      continue;
    }
  }
}

export function getCached<T>(path: string): T | null {
  const database = getDatabase();
  const matchId = parseMatchIdFromPath(path);

  if (matchId === null || !Number.isFinite(matchId)) {
    return null;
  }

  const row = database.prepare('SELECT payload FROM cached_matches WHERE id = ?').get(matchId) as
    { payload: string } | undefined;
  if (row) {
    try {
      return JSON.parse(row.payload) as T;
    } catch {
      return null;
    }
  }

  return null;
}

export function writeCache<T>(path: string, data: T): void {
  const matchId = resolveMatchId(path, data);
  if (matchId === null || !Number.isFinite(matchId)) {
    return;
  }

  const payload = JSON.stringify(data);
  const matchDate =
    typeof data === 'object' && data !== null && 'date' in data && typeof data.date === 'number' ? data.date : null;
  const database = getDatabase();

  database
    .prepare(
      `
        INSERT INTO cached_matches (id, payload, match_date, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          match_date = excluded.match_date,
          updated_at = excluded.updated_at
      `,
    )
    .run(matchId, payload, matchDate, Date.now());
}

export function getAllCachedMatchIds(): number[] {
  const rows = getDatabase().prepare('SELECT id FROM cached_matches ORDER BY id ASC').all() as { id: number }[];
  return rows.map((row) => row.id);
}
