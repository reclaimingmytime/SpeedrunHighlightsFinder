import { BadRequestException, Injectable } from '@nestjs/common';
import { type SQLInputValue } from 'node:sqlite';

import type { MatchData } from '../types';
import {
  clearCachedSplits,
  getCachedMatchIdsBatch,
  getCachedSplitsColumnOptions,
  getCachedSplitsCount,
  getMatchCacheVersion,
  insertCachedSplits,
  queryCachedSplits,
  type CachedSplitRow,
} from '../utils/cache';
import { getLatestEloByPlayer, groupTimelinesByUuid } from '../utils/match';
import { PROGRESSION_EVENTS, STAGE_NAMES } from '../utils/progression';
import { getRankFromElo } from '../utils/ranking';
import { formatDuration, getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

export type CachedSplit = CachedSplitRow;

type SplitPoint = { stageIndex: number; time: number };

type DataTableResponse = {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: CachedSplit[];
  columnControl: Record<string, { label: string; value: string }[]>;
};

const SPLIT_SORT_COLUMNS = ['player', 'rank', 'split', 'seedType', 'duration', 'date'] as const;
const MAX_PAGE_SIZE = 500;
const MATCH_SCAN_BATCH_SIZE = 500;
const SPLIT_INSERT_BATCH_SIZE = 500;

type SplitSortColumn = (typeof SPLIT_SORT_COLUMNS)[number];
type ColumnSearch = { value: string; logic: string; selectedValues: string[] };

@Injectable()
export class SplitsService {
  private lastBuiltMatchCacheVersion: number | null = null;

  private columnControlCache: DataTableResponse['columnControl'] | null = null;

  constructor(private readonly matchService: MatchService) {}

  /**
   * DataTables endpoint. Strictly read-only — never rebuilds the splits cache.
   * Sorting, paging and filtering operate only on the already-built table.
   */
  getDataTablePage(query: Record<string, unknown>): DataTableResponse {
    const draw = this.parseInteger(this.getQueryValue(query, 'draw'), 'draw', 0);
    const start = this.parseInteger(this.getQueryValue(query, 'start'), 'start', 0);
    const length = this.parseInteger(this.getQueryValue(query, 'length'), 'length', 10);

    if (length <= 0 || length > MAX_PAGE_SIZE) {
      throw new BadRequestException(`Query "length" must be between 1 and ${MAX_PAGE_SIZE}.`);
    }

    const searchValue = this.getStringValue(this.getQueryValue(query, 'search[value]'), 'search[value]')
      .trim()
      .toLocaleLowerCase();
    const columnSearches = SPLIT_SORT_COLUMNS.map((_, index) => this.getColumnSearch(query, index));
    const orders = this.parseOrders(query);

    const { whereSql, params } = this.buildWhereClause(searchValue, columnSearches);
    const orderBySql = this.buildOrderByClause(orders);

    const recordsTotal = getCachedSplitsCount();
    const recordsFiltered = getCachedSplitsCount(whereSql, params);
    const data = queryCachedSplits(whereSql, orderBySql, length, start, params);

    return {
      draw,
      recordsTotal,
      recordsFiltered,
      data,
      columnControl: this.columnControlCache ?? getCachedSplitsColumnOptions(),
    };
  }

  //Called only when the splits page itself is loaded, not on sorting, paging or filtering.
  ensureSplitsUpToDate(): void {
    // Recheck after rebuilding: matches may be added/removed while the cache is built.
    let currentVersion = getMatchCacheVersion();
    if (this.lastBuiltMatchCacheVersion === currentVersion) {
      return;
    }

    do {
      currentVersion = getMatchCacheVersion();
      this.doRebuild(currentVersion);
    } while (getMatchCacheVersion() !== currentVersion); // did matches change while we were rebuilding? If so, rebuild again.
  }

  private doRebuild(matchCacheVersion: number): void {
    const eloByPlayer = this.buildEloMap();

    clearCachedSplits();

    const batch: CachedSplitRow[] = [];
    const flushBatch = (): void => {
      if (batch.length === 0) return;
      insertCachedSplits(batch);
      batch.length = 0;
    };

    let lastId = -1;
    while (true) {
      const ids = getCachedMatchIdsBatch(lastId, MATCH_SCAN_BATCH_SIZE);
      if (ids.length === 0) break;

      for (const id of ids) {
        const match = this.matchService.getCachedMatch(id);
        if (!match) continue;

        for (const split of this.getMatchSplits(match, eloByPlayer)) {
          batch.push(split);
          if (batch.length >= SPLIT_INSERT_BATCH_SIZE) {
            flushBatch();
          }
        }
      }

      lastId = ids[ids.length - 1];
    }

    flushBatch();

    this.columnControlCache = getCachedSplitsColumnOptions();
    this.lastBuiltMatchCacheVersion = matchCacheVersion;
  }

  /** Pass 1: scan matches once to collect the highest known ELO per player. */
  private buildEloMap(): Map<string, number | null> {
    const eloByPlayer = new Map<string, number | null>();
    let lastId = -1;

    while (true) {
      const ids = getCachedMatchIdsBatch(lastId, MATCH_SCAN_BATCH_SIZE);
      if (ids.length === 0) break;

      for (const id of ids) {
        const match = this.matchService.getCachedMatch(id);
        if (!match) continue;

        const partial = getLatestEloByPlayer([match]);
        for (const [player, elo] of partial) {
          const existing = eloByPlayer.get(player);
          if (existing === undefined || (elo != null && (existing ?? -1) < elo)) {
            eloByPlayer.set(player, elo);
          }
        }
      }

      lastId = ids[ids.length - 1];
    }

    return eloByPlayer;
  }

  private buildWhereClause(
    globalSearch: string,
    columnSearches: ColumnSearch[],
  ): { whereSql: string; params: SQLInputValue[] } {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (globalSearch) {
      conditions.push(
        `(player LIKE ? OR rank_name LIKE ? OR split LIKE ? OR seed_type LIKE ? OR duration LIKE ? OR date_str LIKE ?)`,
      );
      const like = `%${globalSearch}%`;
      params.push(like, like, like, like, like, like);
    }

    const columnMap: Record<number, string> = {
      0: 'player',
      1: 'rank_name',
      2: 'split',
      3: 'seed_type',
      4: 'duration',
      5: 'date_str',
    };

    columnSearches.forEach(({ value, logic, selectedValues }, index) => {
      const column = columnMap[index];
      if (!column) return;

      if (selectedValues.length > 0) {
        const placeholders = selectedValues.map(() => '?').join(', ');
        conditions.push(`LOWER(${column}) IN (${placeholders})`);
        params.push(...selectedValues);
      }

      if (value) {
        if (logic === 'equal') {
          conditions.push(`LOWER(${column}) = ?`);
          params.push(value);
        } else {
          conditions.push(`LOWER(${column}) LIKE ?`);
          params.push(`%${value}%`);
        }
      }
    });

    return {
      whereSql: conditions.join(' AND '),
      params,
    };
  }

  private buildOrderByClause(orders: { column: SplitSortColumn; direction: 'asc' | 'desc' }[]): string {
    const parts: string[] = [];

    for (const { column, direction } of orders) {
      const dir = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

      switch (column) {
        case 'player':
          parts.push(`player ${dir}`);
          break;
        case 'rank':
          // Treat NULL elo as lowest
          parts.push(`CASE WHEN elo IS NULL THEN -1 ELSE elo END ${dir}`);
          break;
        case 'split':
          parts.push(`from_stage ${dir}, to_stage ${dir}`);
          break;
        case 'seedType':
          parts.push(`seed_type ${dir}`);
          break;
        case 'duration':
          parts.push(`duration_sec ${dir}`);
          break;
        case 'date':
          parts.push(`event_unix ${dir}`);
          break;
      }
    }

    // Stable secondary sort
    parts.push('event_unix DESC', 'match_id DESC');
    return parts.join(', ');
  }

  // ---------------------------------------------------------------------------
  // Query parsing helpers
  // ---------------------------------------------------------------------------

  private getQueryValue(query: Record<string, unknown>, key: string): unknown {
    if (key in query) return query[key];

    const path = key.match(/[^[\]]+/g);
    if (!path) return undefined;

    let value: unknown = query;
    for (const segment of path) {
      if (typeof value !== 'object' || value === null || !(segment in value)) {
        return undefined;
      }
      value = (value as Record<string, unknown>)[segment];
    }
    return value;
  }

  private getColumnSearch(query: Record<string, unknown>, index: number): ColumnSearch {
    const selectedValues = this.getColumnControlList(query, index);
    const columnControlValue = this.getQueryValue(query, `columns[${index}][columnControl][search][value]`);

    if (columnControlValue !== undefined) {
      return {
        value: this.getStringValue(columnControlValue, `columns[${index}][columnControl][search][value]`)
          .trim()
          .toLocaleLowerCase(),
        logic: this.getStringValue(
          this.getQueryValue(query, `columns[${index}][columnControl][search][logic]`),
          `columns[${index}][columnControl][search][logic]`,
        ),
        selectedValues,
      };
    }

    return {
      value: this.getStringValue(
        this.getQueryValue(query, `columns[${index}][search][value]`),
        `columns[${index}][search][value]`,
      )
        .trim()
        .toLocaleLowerCase(),
      logic: 'contains',
      selectedValues,
    };
  }

  private getColumnControlList(query: Record<string, unknown>, index: number): string[] {
    const key = `columns[${index}][columnControl][list]`;
    const nestedValue = this.getQueryValue(query, key);

    if (Array.isArray(nestedValue)) {
      return nestedValue
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.toLocaleLowerCase());
    }

    if (typeof nestedValue === 'object' && nestedValue !== null) {
      return Object.entries(nestedValue)
        .filter(([listIndex, value]) => /^\d+$/.test(listIndex) && typeof value === 'string')
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, value]) => (value as string).toLocaleLowerCase());
    }

    if (typeof nestedValue === 'string') {
      return [nestedValue.toLocaleLowerCase()];
    }

    // Fallback for flattened query-string form: columns[N][columnControl][list][0]=...
    const listPrefix = `${key}[`;
    return Object.entries(query)
      .flatMap(([param, value]) => {
        if (!param.startsWith(listPrefix) || !param.endsWith(']') || typeof value !== 'string') {
          return [];
        }
        const listIndex = param.slice(listPrefix.length, -1);
        return /^\d+$/.test(listIndex) ? [{ index: Number(listIndex), value }] : [];
      })
      .sort((a, b) => a.index - b.index)
      .map(({ value }) => value.toLocaleLowerCase());
  }

  private getStringValue(value: unknown, name: string): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') {
      throw new BadRequestException(`Query "${name}" must be a string.`);
    }
    return value;
  }

  private parseInteger(value: unknown, name: string, defaultValue: number): number {
    if (value === undefined) return defaultValue;

    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
      throw new BadRequestException(`Query "${name}" must be an integer.`);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || (parsed < 0 && name !== 'length')) {
      throw new BadRequestException(`Query "${name}" must be a non-negative integer.`);
    }
    return parsed;
  }

  private parseOrders(query: Record<string, unknown>): { column: SplitSortColumn; direction: 'asc' | 'desc' }[] {
    const orders: { column: SplitSortColumn; direction: 'asc' | 'desc' }[] = [];

    for (let index = 0; index < SPLIT_SORT_COLUMNS.length; index += 1) {
      const columnInput = this.getQueryValue(query, `order[${index}][column]`);
      if (columnInput === undefined) break;

      const columnIndex = this.parseInteger(columnInput, `order[${index}][column]`, 0);
      const column = SPLIT_SORT_COLUMNS[columnIndex];
      if (!column) {
        throw new BadRequestException(`Query "order[${index}][column]" is invalid.`);
      }

      const direction = this.getStringValue(this.getQueryValue(query, `order[${index}][dir]`), `order[${index}][dir]`);
      if (direction !== 'asc' && direction !== 'desc') {
        throw new BadRequestException(`Query "order[${index}][dir]" must be asc or desc.`);
      }

      orders.push({ column, direction });
    }

    return orders.length > 0 ? orders : [{ column: 'duration', direction: 'desc' }];
  }

  // ---------------------------------------------------------------------------
  // Split extraction
  // ---------------------------------------------------------------------------

  private getMatchSplits(match: MatchData, eloByPlayer: Map<string, number | null>): CachedSplitRow[] {
    if (!Array.isArray(match.vod) || match.vod.length === 0) return [];

    const playersByUuid = new Map(match.players.map((p) => [p.uuid, p.nickname]));
    const vodsByUuid = new Map(match.vod.map((v) => [v.uuid, v]));
    const timelinesByUuid = groupTimelinesByUuid(match.timelines);

    const splits: CachedSplitRow[] = [];

    for (const [uuid, events] of timelinesByUuid) {
      const vod = vodsByUuid.get(uuid);
      if (!vod) continue;

      const player = playersByUuid.get(uuid) ?? uuid;
      const elo = eloByPlayer.get(player.trim().toLowerCase()) ?? null;
      const { rankName, rankIndex, rankEmoji } = getRankFromElo(elo);

      events.sort((a, b) => a.time - b.time);

      const splitPoints: SplitPoint[] = [{ stageIndex: 0, time: 0 }];
      let currentStageIndex = 0;

      for (const event of events) {
        const stageIndex = PROGRESSION_EVENTS.get(event.type);
        if (stageIndex === undefined || stageIndex <= currentStageIndex) continue;
        currentStageIndex = stageIndex;
        splitPoints.push({ stageIndex, time: event.time });
      }

      for (let i = 1; i < splitPoints.length; i += 1) {
        const start = splitPoints[i - 1];
        const end = splitPoints[i];

        const durationSeconds = Math.round((end.time - start.time) / 1000);
        const { date, eventUnix, vodTimestamp } = getVodEventTime(match, end.time, vod.startsAt);

        if (durationSeconds < 0 || vodTimestamp < 0) continue;

        splits.push({
          matchId: match.id,
          player,
          seedType: match.seedType ?? 'Unknown',
          elo,
          rankName,
          rankIndex,
          rankEmoji,
          fromStage: STAGE_NAMES[start.stageIndex],
          toStage: STAGE_NAMES[end.stageIndex],
          split: `${STAGE_NAMES[start.stageIndex]} -> ${STAGE_NAMES[end.stageIndex]}`,
          durationSeconds,
          duration: formatDuration(durationSeconds),
          date,
          eventUnix,
          vodLink: `${vod.url}?t=${vodTimestamp}s`,
        });
      }
    }

    return splits;
  }
}
