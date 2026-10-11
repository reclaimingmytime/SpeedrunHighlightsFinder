import { readFile, mkdir, writeFile, readdir, unlink } from 'fs/promises';
import type { Dirent } from 'fs';
import { join } from 'path';

const MATCH_CACHE_FILE_PATTERN = /^match_\d+\.json$/;
const MATCH_CACHE_DIRECTORY = './cache';

export async function removeExpiredMatchCache(
  id: number,
  discoveredDuring: 'startup cleanup' | 'match lookup',
  cacheDirectory = MATCH_CACHE_DIRECTORY,
): Promise<void> {
  try {
    await unlink(join(cacheDirectory, `match_${id}.json`));
    console.info(`Removed expired match cache during ${discoveredDuring}: match_${id}.json`);
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

export async function removeExpiredCachedMatches(
  cacheDirectory = MATCH_CACHE_DIRECTORY,
  now = new Date(),
): Promise<void> {
  let files: Dirent[];
  try {
    files = await readdir(cacheDirectory, { withFileTypes: true });
  } catch (error) {
    if (isErrnoWithCode(error, 'ENOENT')) return;
    throw error;
  }

  for (const file of files) {
    if (!file.isFile() || !MATCH_CACHE_FILE_PATTERN.test(file.name)) continue;

    const path = join(cacheDirectory, file.name);
    const match = await getCached<{ date?: number }>(path);
    if (!match || typeof match.date !== 'number' || !isMatchOlderThanTwoMonths(match.date, now)) continue;

    const id = Number(file.name.slice('match_'.length, -'.json'.length));
    await removeExpiredMatchCache(id, 'startup cleanup', cacheDirectory);
  }
}

export async function getCached<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(path: string, data: T): Promise<void> {
  await mkdir('./cache', { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

export async function getAllCachedMatchIds(): Promise<number[]> {
  const files = await readdir(MATCH_CACHE_DIRECTORY).catch(() => []);

  return files
    .filter((file) => MATCH_CACHE_FILE_PATTERN.test(file))
    .map((file) => Number(file.match(/\d+/)?.[0]))
    .filter((value): value is number => Number.isFinite(value));
}
