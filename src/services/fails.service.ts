import { BadRequestException, Injectable } from '@nestjs/common';

import type {
  CachedFail,
  DeathStage,
  DeathStageOption,
  FailCounts,
  FailType,
  FailTypeOption,
  FailsResult,
  MatchData,
} from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { getLatestEloByPlayer, groupTimelinesByUuid } from '../utils/match';
import { formatStageLabel, PROGRESSION_EVENTS, STAGE_NAMES } from '../utils/progression';
import { getRankFromElo, RANK_THRESHOLDS } from '../utils/ranking';
import { getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

const FAIL_TYPE_LABELS: Record<FailType, string> = {
  death: 'Death',
  forfeit: 'Forfeit',
  reset: 'Reset',
  draw_vote: 'Draw vote',
};

const FAIL_TIMELINE_TYPES = new Map<string, FailType>([
  ['projectelo.timeline.death', 'death'],
  ['projectelo.timeline.forfeit', 'forfeit'],
  ['projectelo.timeline.reset', 'reset'],
]);

const FAIL_TYPES: FailType[] = ['death', 'forfeit', 'reset', 'draw_vote'];

@Injectable()
export class FailsService {
  readonly stages: DeathStageOption[] = STAGE_NAMES.map((value) => ({
    value,
    label: formatStageLabel(value),
  }));

  readonly failTypes: FailTypeOption[] = FAIL_TYPES.map((value) => ({
    value,
    label: FAIL_TYPE_LABELS[value],
  }));

  readonly ranks = RANK_THRESHOLDS.map(({ name, minimumElo }) => ({
    name,
    ...getRankFromElo(minimumElo),
  }));

  constructor(private readonly matchService: MatchService) {}

  async getFails(stageInput?: string, rankInput?: string, typeInput?: string): Promise<FailsResult> {
    const selectedStage = this.parseStage(stageInput);
    const selectedRank = this.parseRank(rankInput);
    const selectedType = this.parseType(typeInput);
    const matchIds = await getAllCachedMatchIds();
    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));
    const cachedMatches = matches.filter((match): match is MatchData => match !== null);
    const eloByPlayer = getLatestEloByPlayer(cachedMatches);
    const allFails = cachedMatches
      .flatMap((match) => this.getMatchFails(match, selectedStage, eloByPlayer))
      .filter((fail) => !selectedRank || fail.rankName === selectedRank)
      .sort((a, b) => b.eventUnix - a.eventUnix);
    const counts = this.getFailCounts(allFails);
    const fails = allFails.filter((fail) => !selectedType || fail.type === selectedType);

    return {
      selectedStage: selectedStage ?? 'all',
      selectedRank: selectedRank ?? 'all',
      selectedType: selectedType ?? 'all',
      counts,
      fails,
    };
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

  private parseType(typeInput?: string): FailType | undefined {
    if (!typeInput || typeInput.toLowerCase() === 'all') return undefined;

    const normalized = typeInput.trim().toLowerCase();
    const type = FAIL_TYPES.find((candidate) => candidate === normalized);
    if (type) return type;

    throw new BadRequestException(`Unknown fail type. Choose from: all, ${FAIL_TYPES.join(', ')}`);
  }

  private getFailCounts(fails: CachedFail[]): FailCounts {
    const counts: FailCounts = { death: 0, forfeit: 0, reset: 0, draw_vote: 0 };
    for (const fail of fails) counts[fail.type]++;
    return counts;
  }

  private getMatchFails(
    match: MatchData,
    selectedStage: DeathStage | undefined,
    eloByPlayer: Map<string, number | null>,
  ): CachedFail[] {
    const playersByUuid = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vodsByUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));
    const timelines = [...match.timelines];
    if (match.forfeited && !timelines.some((event) => event.type === 'projectelo.timeline.forfeit')) {
      const forfeitingPlayerUuid = match.result.uuid
        ? match.players.find((player) => player.uuid !== match.result.uuid)?.uuid
        : match.players[0]?.uuid;
      if (forfeitingPlayerUuid) {
        timelines.push({
          uuid: forfeitingPlayerUuid,
          time: match.result.time,
          type: 'projectelo.timeline.forfeit',
        });
      }
    }
    const timelinesByUuid = groupTimelinesByUuid(timelines);

    const fails: CachedFail[] = [];
    for (const [uuid, events] of timelinesByUuid) {
      events.sort((a, b) => a.time - b.time);
      let stageIndex = 0;

      for (const event of events) {
        stageIndex = Math.max(stageIndex, PROGRESSION_EVENTS.get(event.type) ?? 0);
        const timelineType = FAIL_TIMELINE_TYPES.get(event.type);
        const type =
          timelineType === 'forfeit' && match.forfeited && match.result.uuid === null ? 'draw_vote' : timelineType;
        if (!type) continue;

        const stage = STAGE_NAMES[stageIndex];
        if (selectedStage && stage !== selectedStage) continue;

        const vod = vodsByUuid.get(uuid);
        if (!vod) continue;
        const { date, eventUnix, vodTimestamp } = getVodEventTime(match, event.time, vod.startsAt);
        if (vodTimestamp < 0) continue;
        const player = playersByUuid.get(uuid) ?? uuid;
        const elo = eloByPlayer.get(player.trim().toLowerCase()) ?? null;
        const { rankName, rankIndex, rankEmoji } = getRankFromElo(elo);
        fails.push({
          matchId: match.id,
          player,
          type,
          typeLabel: FAIL_TYPE_LABELS[type],
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

    return fails;
  }
}
