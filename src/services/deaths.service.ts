import { BadRequestException, Injectable } from '@nestjs/common';

import type {
  CachedDeath,
  DeathStage,
  DeathStageOption,
  DeathsResult,
  MatchData,
  PlayerLatestElo,
  Timeline,
} from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { getRankFromElo } from '../utils/ranking';
import { getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

const STAGE_NAMES = [
  'overworld',
  'entered nether',
  'bastion',
  'fortress',
  'finding stronghold',
  'stronghold',
  'end',
] as const satisfies readonly DeathStage[];

const PROGRESSION_EVENTS = new Map<string, number>([
  ['story.enter_the_nether', 1],
  ['nether.find_bastion', 2],
  ['nether.loot_bastion', 2],
  ['nether.find_fortress', 3],
  ['nether.obtain_blaze_rod', 3],
  ['projectelo.timeline.blind_travel', 4],
  ['story.follow_ender_eye', 5],
  ['story.enter_the_end', 6],
  ['end.root', 6],
]);

const RANK_THRESHOLDS = [
  { name: 'Coal', minimumElo: 0 },
  { name: 'Iron', minimumElo: 600 },
  { name: 'Gold', minimumElo: 900 },
  { name: 'Emerald', minimumElo: 1200 },
  { name: 'Diamond', minimumElo: 1500 },
  { name: 'Netherite', minimumElo: 2000 },
] as const;

function formatStageLabel(stage: DeathStage): string {
  const normalized = stage.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return normalized.join(' ');
}

@Injectable()
export class DeathsService {
  readonly stages: DeathStageOption[] = STAGE_NAMES.map((value) => ({
    value,
    label: formatStageLabel(value),
  }));

  readonly ranks = RANK_THRESHOLDS.map(({ name, minimumElo }) => ({
    name,
    ...getRankFromElo(minimumElo),
  }));

  constructor(private readonly matchService: MatchService) {}

  async getDeaths(stageInput?: string, rankInput?: string): Promise<DeathsResult> {
    const selectedStage = this.parseStage(stageInput);
    const selectedRank = this.parseRank(rankInput);
    const matchIds = await getAllCachedMatchIds();
    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));
    const cachedMatches = matches.filter((match): match is MatchData => match !== null);
    const eloByPlayer = this.getLatestEloByPlayer(cachedMatches);
    const deaths = cachedMatches
      .flatMap((match) => this.getMatchDeaths(match, selectedStage, eloByPlayer))
      .filter((death) => !selectedRank || death.rankName === selectedRank)
      .sort((a, b) => b.eventUnix - a.eventUnix);

    return { selectedStage: selectedStage ?? 'all', selectedRank: selectedRank ?? 'all', deaths };
  }

  private parseStage(stageInput?: string): DeathStage | undefined {
    if (!stageInput || stageInput.toLowerCase() === 'all') return undefined;

    const normalized = stageInput.toLowerCase().trim().replace(/[-_]+/g, ' ');
    const stage = STAGE_NAMES.find((candidate) => candidate === normalized);
    if (stage) return stage;

    throw new BadRequestException(`Unknown stage. Choose from: all, ${STAGE_NAMES.join(', ')}`);
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

  private getMatchDeaths(
    match: MatchData,
    selectedStage: DeathStage | undefined,
    eloByPlayer: Map<string, number | null>,
  ): CachedDeath[] {
    const playersByUuid = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vodsByUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));
    const timelinesByUuid = new Map<string, Timeline[]>();

    for (const event of match.timelines) {
      const events = timelinesByUuid.get(event.uuid) ?? [];
      events.push(event);
      timelinesByUuid.set(event.uuid, events);
    }

    const deaths: CachedDeath[] = [];
    for (const [uuid, events] of timelinesByUuid) {
      events.sort((a, b) => a.time - b.time);
      let stageIndex = 0;

      for (const event of events) {
        stageIndex = Math.max(stageIndex, PROGRESSION_EVENTS.get(event.type) ?? 0);
        if (event.type !== 'projectelo.timeline.death') continue;

        const stage = STAGE_NAMES[stageIndex];
        if (selectedStage && stage !== selectedStage) continue;

        const vod = vodsByUuid.get(uuid);
        if (!vod) continue;
        const { date, eventUnix, vodTimestamp } = getVodEventTime(match, event.time, vod.startsAt);
        if (vodTimestamp < 0) continue;
        const player = playersByUuid.get(uuid) ?? uuid;
        const elo = eloByPlayer.get(player.trim().toLowerCase()) ?? null;
        const { rankName, rankIndex, rankEmoji } = getRankFromElo(elo);
        deaths.push({
          matchId: match.id,
          player,
          stage,
          stageLabel: formatStageLabel(stage),
          elo,
          rankName,
          rankIndex,
          rankEmoji,
          date,
          eventUnix,
          vodLink: `${vod.url}?t=${Math.max(0, vodTimestamp - 6)}s`,
        });
      }
    }

    return deaths;
  }
}
