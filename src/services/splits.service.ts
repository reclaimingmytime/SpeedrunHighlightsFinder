import { BadRequestException, Injectable } from '@nestjs/common';

import type { DeathStage, MatchData } from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { getLatestEloByPlayer, groupTimelinesByUuid } from '../utils/match';
import { PROGRESSION_EVENTS, STAGE_NAMES } from '../utils/progression';
import { getRankFromElo } from '../utils/ranking';
import { getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

export type CachedSplit = {
  matchId: number;
  player: string;
  elo: number | null;
  rankName: string;
  rankIndex: number;
  rankEmoji: string;
  fromStage: DeathStage;
  toStage: DeathStage;
  split: string;
  durationSeconds: number;
  duration: string;
  date: string;
  eventUnix: number;
  vodLink: string;
};

type SplitPoint = { stageIndex: number; time: number };

type DataTableResponse = {
  draw: number;
  recordsTotal: number;
  recordsFiltered: number;
  data: CachedSplit[];
  columnControl: Record<string, { label: string; value: string }[]>;
};

type SplitDataset = {
  splits: CachedSplit[];
  columnControl: DataTableResponse['columnControl'];
};

const SPLIT_SORT_COLUMNS = ['player', 'rank', 'split', 'duration', 'date'] as const;
type SplitSortColumn = (typeof SPLIT_SORT_COLUMNS)[number];
type ColumnSearch = { value: string; logic: string; selectedValues: string[] };

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

@Injectable()
export class SplitsService {
  private splitDataset: { matchIdsKey: string; dataset: SplitDataset } | null = null;

  private splitDatasetBuild: { matchIdsKey: string; promise: Promise<SplitDataset> } | null = null;

  constructor(private readonly matchService: MatchService) {}

  async getDataTablePage(query: Record<string, unknown>): Promise<DataTableResponse> {
    const draw = this.parseInteger(this.getQueryValue(query, 'draw'), 'draw', 0);
    const start = this.parseInteger(this.getQueryValue(query, 'start'), 'start', 0);
    const length = this.parseInteger(this.getQueryValue(query, 'length'), 'length', 10);
    if (length === 0 || length < -1) {
      throw new BadRequestException('Query "length" must be -1 or a positive integer.');
    }

    const searchValue = this.getStringValue(this.getQueryValue(query, 'search[value]'), 'search[value]')
      .trim()
      .toLocaleLowerCase();
    const columnSearches = SPLIT_SORT_COLUMNS.map((_, index) => this.getColumnSearch(query, index));
    const orders = this.parseOrders(query);
    const matchIds = await getAllCachedMatchIds();
    const { splits: allSplits, columnControl } = await this.getSplitDataset(matchIds);
    const hasSearch =
      Boolean(searchValue) ||
      columnSearches.some(({ value, selectedValues }) => Boolean(value) || selectedValues.length > 0);
    const filteredSplits = hasSearch
      ? allSplits.filter((split) => this.matchesSearch(split, searchValue, columnSearches))
      : allSplits;

    return {
      draw,
      recordsTotal: allSplits.length,
      recordsFiltered: filteredSplits.length,
      data: this.sortSplits(filteredSplits, orders).slice(start, length === -1 ? undefined : start + length),
      columnControl,
    };
  }

  private async getSplitDataset(matchIds: number[]): Promise<SplitDataset> {
    const sortedMatchIds = [...matchIds].sort((a, b) => a - b);
    const matchIdsKey = JSON.stringify(sortedMatchIds);
    if (this.splitDataset?.matchIdsKey === matchIdsKey) return this.splitDataset.dataset;
    if (this.splitDatasetBuild?.matchIdsKey === matchIdsKey) return this.splitDatasetBuild.promise;

    const pending = {
      matchIdsKey,
      promise: this.buildSplitDataset(sortedMatchIds),
    };
    this.splitDatasetBuild = pending;

    try {
      const dataset = await pending.promise;
      if (this.splitDatasetBuild === pending) {
        this.splitDataset = { matchIdsKey, dataset };
        this.splitDatasetBuild = null;
      }
      return dataset;
    } catch (error) {
      if (this.splitDatasetBuild === pending) this.splitDatasetBuild = null;
      throw error;
    }
  }

  private async buildSplitDataset(matchIds: number[]): Promise<SplitDataset> {
    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));
    const cachedMatches = matches.filter((match): match is MatchData => match !== null);
    const eloByPlayer = getLatestEloByPlayer(cachedMatches);
    const splits = cachedMatches.flatMap((match) => this.getMatchSplits(match, eloByPlayer));
    return { splits, columnControl: this.getColumnControlOptions(splits) };
  }

  private getColumnControlOptions(splits: CachedSplit[]): Record<string, { label: string; value: string }[]> {
    const ranks = new Map<string, number>();
    const splitOptions = new Map<string, { label: string; value: string }>();

    for (const split of splits) {
      ranks.set(split.rankName, split.rankIndex);
      splitOptions.set(split.split, { label: split.split, value: split.split });
    }

    return {
      rankName: Array.from(ranks, ([value, rankIndex]) => ({
        label: value === '—' ? 'Unranked' : value,
        value,
        rankIndex,
      }))
        .sort((a, b) => a.rankIndex - b.rankIndex)
        .map(({ label, value }) => ({ label, value })),
      split: Array.from(splitOptions.values()).sort((a, b) =>
        a.value.localeCompare(b.value, undefined, { numeric: true }),
      ),
    };
  }

  private getQueryValue(query: Record<string, unknown>, key: string): unknown {
    if (key in query) return query[key];

    const path = key.match(/[^[\]]+/g);
    if (!path) return undefined;

    let value: unknown = query;
    for (const segment of path) {
      if (typeof value !== 'object' || value === null || !(segment in value)) return undefined;
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
        .sort(([indexA], [indexB]) => Number(indexA) - Number(indexB))
        .map(([, value]) => (value as string).toLocaleLowerCase());
    }
    if (typeof nestedValue === 'string') return [nestedValue.toLocaleLowerCase()];

    const listPrefix = `${key}[`;
    return Object.entries(query)
      .flatMap(([param, value]) => {
        if (!param.startsWith(listPrefix) || !param.endsWith(']') || typeof value !== 'string') return [];
        const listIndex = param.slice(listPrefix.length, -1);
        return /^\d+$/.test(listIndex) ? [{ index: Number(listIndex), value }] : [];
      })
      .sort((a, b) => a.index - b.index)
      .map(({ value }) => value.toLocaleLowerCase());
  }

  private getStringValue(value: unknown, name: string): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new BadRequestException(`Query "${name}" must be a string.`);
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
      if (!column) throw new BadRequestException(`Query "order[${index}][column]" is invalid.`);

      const direction = this.getStringValue(this.getQueryValue(query, `order[${index}][dir]`), `order[${index}][dir]`);
      if (direction !== 'asc' && direction !== 'desc') {
        throw new BadRequestException(`Query "order[${index}][dir]" must be asc or desc.`);
      }
      orders.push({ column, direction });
    }
    return orders.length ? orders : [{ column: 'duration', direction: 'desc' }];
  }

  private matchesSearch(split: CachedSplit, globalSearch: string, columnSearches: ColumnSearch[]): boolean {
    const columnValues = [split.player, split.rankName, split.split, split.duration, split.date];
    const globalMatches =
      !globalSearch || columnValues.some((value) => value.toLocaleLowerCase().includes(globalSearch));
    const columnsMatch = columnSearches.every(({ value, logic, selectedValues }, index) => {
      const normalizedValue = columnValues[index].toLocaleLowerCase();
      const listMatches = selectedValues.length === 0 || selectedValues.includes(normalizedValue);
      const searchMatches = !value || (logic === 'equal' ? normalizedValue === value : normalizedValue.includes(value));
      return listMatches && searchMatches;
    });
    return globalMatches && columnsMatch;
  }

  private sortSplits(
    splits: CachedSplit[],
    orders: { column: SplitSortColumn; direction: 'asc' | 'desc' }[],
  ): CachedSplit[] {
    return [...splits].sort((a, b) => {
      for (const { column, direction } of orders) {
        let comparison = 0;
        switch (column) {
          case 'player':
            comparison = a.player.localeCompare(b.player);
            break;
          case 'rank':
            comparison = (a.elo ?? -1) - (b.elo ?? -1);
            break;
          case 'split':
            comparison =
              STAGE_NAMES.indexOf(a.fromStage) - STAGE_NAMES.indexOf(b.fromStage) ||
              STAGE_NAMES.indexOf(a.toStage) - STAGE_NAMES.indexOf(b.toStage);
            break;
          case 'duration':
            comparison = a.durationSeconds - b.durationSeconds;
            break;
          case 'date':
            comparison = a.eventUnix - b.eventUnix;
            break;
        }
        if (comparison !== 0) return direction === 'asc' ? comparison : -comparison;
      }

      return b.eventUnix - a.eventUnix || b.matchId - a.matchId;
    });
  }

  private getMatchSplits(match: MatchData, eloByPlayer: Map<string, number | null>): CachedSplit[] {
    if (!Array.isArray(match.vod) || match.vod.length === 0) return [];

    const playersByUuid = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vodsByUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));
    const timelinesByUuid = groupTimelinesByUuid(match.timelines);

    const splits: CachedSplit[] = [];
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

      for (let index = 1; index < splitPoints.length; index += 1) {
        const start = splitPoints[index - 1];
        const end = splitPoints[index];
        const durationSeconds = Math.round((end.time - start.time) / 1000);
        const { date, eventUnix, vodTimestamp } = getVodEventTime(match, end.time, vod.startsAt);

        if (durationSeconds < 0 || vodTimestamp < 0) continue;

        splits.push({
          matchId: match.id,
          player,
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
