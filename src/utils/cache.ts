import { mkdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { join } from 'path';

const MATCH_CACHE_DIRECTORY = './cache';
const MATCH_CACHE_DATABASE_PATH = join(MATCH_CACHE_DIRECTORY, 'matches.db');

let databaseInstance: DatabaseSync | null = null;

type MatchCacheRow = {
  id: number;
  match_date: number | null;
};

export type CachedSplitRow = {
  matchId: number;
  player: string;
  seedType: string;
  elo: number | null;
  rankName: string;
  rankIndex: number;
  rankEmoji: string;
  fromStage: string;
  toStage: string;
  split: string;
  durationSeconds: number;
  duration: string;
  date: string;
  eventUnix: number;
  vodLink: string;
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
  if (databaseInstance) return databaseInstance;

  mkdirSync(MATCH_CACHE_DIRECTORY, { recursive: true });

  const database = new DatabaseSync(MATCH_CACHE_DATABASE_PATH);

  database.exec(`
    CREATE TABLE IF NOT EXISTS cache_meta (
                                            key TEXT PRIMARY KEY,
                                            value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO cache_meta (key, value) VALUES ('match_cache_version', 0);

    CREATE TABLE IF NOT EXISTS cached_matches (
                                                id INTEGER PRIMARY KEY,
                                                payload TEXT NOT NULL,
                                                match_date INTEGER,
                                                updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cached_matches_match_date ON cached_matches(match_date);

    CREATE TABLE IF NOT EXISTS cached_splits (
                                               id INTEGER PRIMARY KEY AUTOINCREMENT,
                                               match_id INTEGER NOT NULL,
                                               player TEXT NOT NULL COLLATE NOCASE,
                                               seed_type TEXT NOT NULL,
                                               elo INTEGER,
                                               rank_name TEXT NOT NULL,
                                               rank_index INTEGER NOT NULL,
                                               rank_emoji TEXT NOT NULL,
                                               from_stage TEXT NOT NULL,
                                               to_stage TEXT NOT NULL,
                                               split TEXT NOT NULL,
                                               duration_sec INTEGER NOT NULL,
                                               duration TEXT NOT NULL,
                                               event_unix INTEGER NOT NULL,
                                               date_str TEXT NOT NULL,
                                               vod_link TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_splits_match_id ON cached_splits(match_id);
    CREATE INDEX IF NOT EXISTS idx_splits_player ON cached_splits(player);
    CREATE INDEX IF NOT EXISTS idx_splits_elo ON cached_splits(elo);
    CREATE INDEX IF NOT EXISTS idx_splits_split ON cached_splits(from_stage, to_stage);
    CREATE INDEX IF NOT EXISTS idx_splits_seed ON cached_splits(seed_type);
    CREATE INDEX IF NOT EXISTS idx_splits_duration ON cached_splits(duration_sec);
    CREATE INDEX IF NOT EXISTS idx_splits_event ON cached_splits(event_unix);
  `);

  databaseInstance = database;
  return database;
}

function incrementMatchCacheVersion(database = getDatabase()): void {
  database.prepare("UPDATE cache_meta SET value = value + 1 WHERE key = 'match_cache_version'").run();
}

export function getMatchCacheVersion(): number {
  const row = getDatabase().prepare("SELECT value FROM cache_meta WHERE key = 'match_cache_version'").get() as {
    value: number;
  };
  return row.value;
}

export function removeExpiredMatchCache(
  id: number,
  matchDate: number,
  discoveredDuring: 'startup cleanup' | 'match lookup',
): void {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM cached_matches WHERE id = ?').run(id);

    if ((db.prepare('SELECT changes() AS changed').get() as { changed: number }).changed > 0) {
      incrementMatchCacheVersion(db);
    }

    db.prepare('DELETE FROM cached_splits WHERE match_id = ?').run(id);

    console.info(
      `Removed expired match cache during ${discoveredDuring}: match_${id} from ${new Date(matchDate * 1000).toISOString()}`,
    );
  } catch (error) {
    if (!isErrnoWithCode(error, 'ENOENT')) throw error;
  }
}

export function isMatchOlderThanTwoMonths(matchDate: number, now = new Date()): boolean {
  if (!Number.isFinite(matchDate)) return false;

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

export function removeExpiredCachedMatches(now = new Date()): void {
  const db = getDatabase();
  const pageSize = 500;
  let lastId = -1;

  while (true) {
    const rows = db
      .prepare('SELECT id, match_date FROM cached_matches WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(lastId, pageSize) as MatchCacheRow[];

    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.id;
      try {
        if (typeof row.match_date !== 'number' || !isMatchOlderThanTwoMonths(row.match_date, now)) {
          continue;
        }
        removeExpiredMatchCache(row.id, row.match_date, 'startup cleanup');
      } catch {
        // Skip individual failures and continue scanning.
      }
    }
  }
}

export function getCached<T>(path: string): T | null {
  const matchId = parseMatchIdFromPath(path);
  if (matchId === null || !Number.isFinite(matchId)) return null;

  const row = getDatabase().prepare('SELECT payload FROM cached_matches WHERE id = ?').get(matchId) as
    { payload: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(path: string, data: T): void {
  const matchId = resolveMatchId(path, data);
  if (matchId === null || !Number.isFinite(matchId)) return;

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
        WHERE payload IS NOT excluded.payload OR match_date IS NOT excluded.match_date
      `,
    )
    .run(matchId, payload, matchDate, Date.now());

  if ((database.prepare('SELECT changes() AS changed').get() as { changed: number }).changed > 0) {
    incrementMatchCacheVersion(database);
  }
}

export function getAllCachedMatchIds(): number[] {
  const rows = getDatabase().prepare('SELECT id FROM cached_matches ORDER BY id ASC').all() as { id: number }[];
  return rows.map((row) => row.id);
}

/** Fetch a bounded page of IDs using keyset pagination (no large OFFSET scan). */
export function getCachedMatchIdsBatch(afterId: number, limit = 500): number[] {
  const rows = getDatabase()
    .prepare('SELECT id FROM cached_matches WHERE id > ? ORDER BY id ASC LIMIT ?')
    .all(afterId, limit) as { id: number }[];
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Splits table helpers
// ---------------------------------------------------------------------------

export function clearCachedSplits(): void {
  getDatabase().exec('DELETE FROM cached_splits');
}

export function insertCachedSplits(rows: CachedSplitRow[]): void {
  if (rows.length === 0) return;

  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO cached_splits (
      match_id, player, seed_type, elo, rank_name, rank_index, rank_emoji,
      from_stage, to_stage, split, duration_sec, duration, event_unix, date_str, vod_link
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const row of rows) {
      insert.run(
        row.matchId,
        row.player,
        row.seedType,
        row.elo,
        row.rankName,
        row.rankIndex,
        row.rankEmoji,
        row.fromStage,
        row.toStage,
        row.split,
        row.durationSeconds,
        row.duration,
        row.eventUnix,
        row.date,
        row.vodLink,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getCachedSplitsCount(whereSql = '', params: SQLInputValue[] = []): number {
  const sql = whereSql
    ? `SELECT COUNT(*) AS c FROM cached_splits WHERE ${whereSql}`
    : 'SELECT COUNT(*) AS c FROM cached_splits';

  const row = getDatabase()
    .prepare(sql)
    .get(...params) as { c: number };

  return row.c;
}

export function queryCachedSplits(
  whereSql: string,
  orderBySql: string,
  limit: number,
  offset: number,
  params: SQLInputValue[] = [],
): CachedSplitRow[] {
  const where = whereSql ? `WHERE ${whereSql}` : '';
  const limitClause = limit < 0 ? '' : 'LIMIT ?';
  const offsetClause = limit < 0 ? '' : 'OFFSET ?';

  const sql = `
    SELECT
      match_id AS matchId,
      player,
      seed_type AS seedType,
      elo,
      rank_name AS rankName,
      rank_index AS rankIndex,
      rank_emoji AS rankEmoji,
      from_stage AS fromStage,
      to_stage AS toStage,
      split,
      duration_sec AS durationSeconds,
      duration,
      event_unix AS eventUnix,
      date_str AS date,
      vod_link AS vodLink
    FROM cached_splits
           ${where}
    ORDER BY ${orderBySql}
      ${limitClause}
             ${offsetClause}
  `;

  const allParams: SQLInputValue[] = limit < 0 ? params : [...params, limit, offset];

  return getDatabase()
    .prepare(sql)
    .all(...allParams) as CachedSplitRow[];
}

export function getCachedSplitsColumnOptions(): {
  rankName: { label: string; value: string }[];
  split: { label: string; value: string }[];
  seedType: { label: string; value: string }[];
} {
  const db = getDatabase();

  const ranks = db
    .prepare(
      `
        SELECT rank_name AS value, MIN(rank_index) AS rankIndex
        FROM cached_splits
        GROUP BY rank_name
        ORDER BY rankIndex ASC
      `,
    )
    .all() as { value: string; rankIndex: number }[];

  const splits = db
    .prepare(
      `
        SELECT DISTINCT split AS value
        FROM cached_splits
        ORDER BY value COLLATE NOCASE
      `,
    )
    .all() as { value: string }[];

  const seedTypes = db
    .prepare(
      `
        SELECT DISTINCT seed_type AS value
        FROM cached_splits
        ORDER BY value COLLATE NOCASE
      `,
    )
    .all() as { value: string }[];

  return {
    rankName: ranks.map(({ value }) => ({
      label: value === '—' ? 'Unranked' : value,
      value,
    })),
    split: splits.map(({ value }) => ({ label: value, value })),
    seedType: seedTypes.map(({ value }) => ({ label: value, value })),
  };
}
