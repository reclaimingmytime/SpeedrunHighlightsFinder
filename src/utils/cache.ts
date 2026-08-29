import { readFile, mkdir, writeFile, readdir } from 'fs/promises';

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
  const files = await readdir('./cache').catch(() => []);

  return files
    .filter((file) => /^match_\d+\.json$/.test(file))
    .map((file) => Number(file.match(/\d+/)?.[0]))
    .filter((value): value is number => Number.isFinite(value));
}
