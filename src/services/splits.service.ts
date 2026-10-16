import { BadRequestException, Injectable } from '@nestjs/common';

import type { DeathStage, MatchData, PlayerLatestElo, Timeline } from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { PROGRESSION_EVENTS, STAGE_NAMES } from '../utils/progression';
import { getRankFromElo, RANK_THRESHOLDS } from '../utils/ranking';
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
  durationSeconds: number;
  duration: string;
  date: string;
  eventUnix: number;
  vodLink: string;
};

type SplitPoint = { stageIndex: number; time: number };
type SplitOption = { value: string; label: string };
const SPLITS_PER_PAGE = 100;

export type SplitsPage = {
  splits: CachedSplit[];
  splitOptions: SplitOption[];
  playerOptions: string[];
  selectedRank: string;
  rankQuery: string;
  selectedSplit: string;
  selectedPlayer: string;
  playerQuery: string;
  selectedOrder: 'asc' | 'desc';
  page: number;
  pageCount: number;
  totalSplits: number;
  previousPage: number;
  nextPage: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

@Injectable()
export class SplitsService {
  constructor(private readonly matchService: MatchService) {}

  async getSplits(
    pageInput?: string,
    rankInput?: string,
    splitInput?: string,
    orderInput?: string,
    playerInput?: string,
  ): Promise<SplitsPage> {
    const matchIds = await getAllCachedMatchIds();
    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));
    const cachedMatches = matches.filter((match): match is MatchData => match !== null);
    const eloByPlayer = this.getLatestEloByPlayer(cachedMatches);
    const allSplits = cachedMatches.flatMap((match) => this.getMatchSplits(match, eloByPlayer));
    const selectedRank = this.parseRank(rankInput);
    const splitOptions = this.getSplitOptions(allSplits);
    const selectedSplit = this.parseSplit(splitInput, splitOptions);
    const selectedOrder = this.parseOrder(orderInput);
    const selectedPlayer = playerInput?.trim() ?? '';
    const playerOptions = Array.from(new Set(allSplits.map(({ player }) => player))).sort((a, b) => a.localeCompare(b));
    const filteredSplits = allSplits
      .filter(
        (split) =>
          (!selectedRank || split.rankName === selectedRank) &&
          (!selectedSplit || this.getSplitKey(split) === selectedSplit) &&
          (!selectedPlayer || split.player.toLowerCase().includes(selectedPlayer.toLowerCase())),
      )
      .sort((a, b) =>
        selectedOrder === 'asc'
          ? a.durationSeconds - b.durationSeconds || a.eventUnix - b.eventUnix
          : b.durationSeconds - a.durationSeconds || b.eventUnix - a.eventUnix,
      );
    const pageCount = Math.max(1, Math.ceil(filteredSplits.length / SPLITS_PER_PAGE));
    const requestedPage = Number(pageInput);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pageCount) : 1;
    const start = (page - 1) * SPLITS_PER_PAGE;

    return {
      splits: filteredSplits.slice(start, start + SPLITS_PER_PAGE),
      splitOptions,
      playerOptions,
      selectedRank: selectedRank ?? 'all',
      rankQuery: selectedRank === '—' ? 'unranked' : (selectedRank ?? 'all'),
      selectedSplit: selectedSplit ?? 'all',
      selectedPlayer,
      playerQuery: encodeURIComponent(selectedPlayer),
      selectedOrder,
      page,
      pageCount,
      totalSplits: filteredSplits.length,
      previousPage: Math.max(1, page - 1),
      nextPage: Math.min(pageCount, page + 1),
      hasPrevious: page > 1,
      hasNext: page < pageCount,
    };
  }

  private parseRank(rankInput?: string): string | undefined {
    if (!rankInput || rankInput.toLowerCase() === 'all') return undefined;

    const normalized = rankInput.trim().toLowerCase();
    if (normalized === 'unranked') return '—';

    const rank = RANK_THRESHOLDS.find(({ name }) => name.toLowerCase() === normalized);
    if (rank) return rank.name;

    throw new BadRequestException(
      `Unknown rank. Choose from: all, ${RANK_THRESHOLDS.map(({ name }) => name).join(', ')}, unranked`,
    );
  }

  private parseSplit(splitInput: string | undefined, options: SplitOption[]): string | undefined {
    if (!splitInput || splitInput.toLowerCase() === 'all') return undefined;
    if (options.some(({ value }) => value === splitInput)) return splitInput;

    throw new BadRequestException(`Unknown split. Choose from: all, ${options.map(({ label }) => label).join(', ')}`);
  }

  private parseOrder(orderInput?: string): 'asc' | 'desc' {
    if (!orderInput || orderInput.toLowerCase() === 'desc') return 'desc';
    if (orderInput.toLowerCase() === 'asc') return 'asc';

    throw new BadRequestException('Unknown order. Choose from: asc, desc');
  }

  private getSplitOptions(splits: CachedSplit[]): SplitOption[] {
    const options = new Map<string, SplitOption>();
    for (const split of splits) {
      const value = this.getSplitKey(split);
      options.set(value, { value, label: `${split.fromStage} -> ${split.toStage}` });
    }

    return Array.from(options.values()).sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
  }

  private getSplitKey(split: Pick<CachedSplit, 'fromStage' | 'toStage'>): string {
    return `${STAGE_NAMES.indexOf(split.fromStage)}-${STAGE_NAMES.indexOf(split.toStage)}`;
  }

  private getLatestEloByPlayer(matches: MatchData[]): Map<string, number | null> {
    const eloByPlayer = new Map<string, PlayerLatestElo>();

    for (const match of matches) {
      if (!Array.isArray(match.vod) || match.vod.length === 0) continue;

      for (const player of match.players) {
        if (!player.nickname || player.nickname.trim().toLowerCase() === '[ranked bot]') continue;

        const key = player.nickname.trim().toLowerCase();
        const current = eloByPlayer.get(key) ?? { elo: null, seenAt: 0 };
        if (typeof player.eloRate === 'number' && match.date > current.seenAt) {
          current.elo = player.eloRate;
          current.seenAt = match.date;
        }
        eloByPlayer.set(key, current);
      }
    }

    return new Map(Array.from(eloByPlayer, ([player, info]) => [player, info.elo]));
  }

  private getMatchSplits(match: MatchData, eloByPlayer: Map<string, number | null>): CachedSplit[] {
    if (!Array.isArray(match.vod) || match.vod.length === 0) return [];

    const playersByUuid = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vodsByUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));
    const timelinesByUuid = new Map<string, Timeline[]>();

    for (const event of match.timelines) {
      const events = timelinesByUuid.get(event.uuid) ?? [];
      events.push(event);
      timelinesByUuid.set(event.uuid, events);
    }

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
