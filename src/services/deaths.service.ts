import { BadRequestException, Injectable } from '@nestjs/common';

import type { CachedDeath, DeathStage, DeathStageOption, DeathsResult, MatchData } from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { getLatestEloByPlayer, groupTimelinesByUuid } from '../utils/match';
import { PROGRESSION_EVENTS, STAGE_NAMES } from '../utils/progression';
import { getRankFromElo, RANK_THRESHOLDS } from '../utils/ranking';
import { getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

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
    const eloByPlayer = getLatestEloByPlayer(cachedMatches);
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

  private getMatchDeaths(
    match: MatchData,
    selectedStage: DeathStage | undefined,
    eloByPlayer: Map<string, number | null>,
  ): CachedDeath[] {
    const playersByUuid = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vodsByUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));
    const timelinesByUuid = groupTimelinesByUuid(match.timelines);

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
