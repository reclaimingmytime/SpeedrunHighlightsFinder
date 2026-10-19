import { BadRequestException, Injectable } from '@nestjs/common';

import type { DeathStage, DeathStageOption, MatchData, OpponentForfeit } from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { formatStageLabel, getStageAtTime, STAGE_NAMES } from '../utils/progression';
import { formatDuration, getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

@Injectable()
export class OpponentForfeitService {
  readonly stages: DeathStageOption[] = STAGE_NAMES.map((value) => ({
    value,
    label: formatStageLabel(value),
  }));

  constructor(private readonly matchService: MatchService) {}

  async getOpponentForfeits(stageInput?: string): Promise<{
    selectedStage: string;
    opponentForfeits: OpponentForfeit[];
  }> {
    const selectedStage = this.parseStage(stageInput);
    const matchIds = await getAllCachedMatchIds();
    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));
    const opponentForfeits = matches
      .filter((match): match is MatchData => match !== null)
      .map((match) => this.findOpponentForfeit(match))
      .filter((forfeit): forfeit is OpponentForfeit => forfeit !== null)
      .filter((forfeit) => !selectedStage || forfeit.stage === selectedStage)
      .sort((a, b) => b.eventUnix - a.eventUnix);

    return {
      selectedStage: selectedStage ?? 'all',
      opponentForfeits,
    };
  }

  findOpponentForfeit(match: MatchData): OpponentForfeit | null {
    if (!match.forfeited || !match.result.uuid || match.vod.length === 0) {
      return null;
    }

    const forfeitTimelines = match.timelines.filter((timeline) => timeline.type === 'projectelo.timeline.forfeit');
    const forfeitingPlayers = new Set(forfeitTimelines.map(({ uuid }) => uuid));
    if (forfeitingPlayers.size > 1) {
      return null;
    }

    const forfeitingPlayer = match.players.find((player) => player.uuid !== match.result.uuid);
    const winner = match.players.find((player) => player.uuid === match.result.uuid);
    if (
      !forfeitingPlayer ||
      !winner ||
      (forfeitingPlayers.size === 1 && !forfeitingPlayers.has(forfeitingPlayer.uuid))
    ) {
      return null;
    }

    const vod = match.vod.find((item) => item.uuid === winner.uuid);
    if (!vod) {
      return null;
    }

    const forfeitTime = forfeitTimelines.find(({ uuid }) => uuid === forfeitingPlayer.uuid)?.time ?? match.result.time;
    const { vodTimestamp, date, eventUnix } = getVodEventTime(match, forfeitTime, vod.startsAt);
    const forfeitTimeSeconds = Math.floor(forfeitTime / 1000);
    const stage = getStageAtTime(match.timelines, winner.uuid, forfeitTime);

    return {
      player: winner.nickname,
      stage,
      stageLabel: formatStageLabel(stage),
      forfeitTime: formatDuration(forfeitTimeSeconds),
      forfeitTimeSeconds,
      vodLink: `${vod.url}?t=${Math.max(0, vodTimestamp)}s`,
      date,
      eventUnix,
    };
  }

  private parseStage(stageInput?: string): DeathStage | undefined {
    if (!stageInput || stageInput.toLowerCase() === 'all') return undefined;

    const normalized = stageInput.toLowerCase().trim().replace(/[-_]+/g, ' ');
    const stage = STAGE_NAMES.find((candidate) => candidate === normalized);
    if (stage) return stage;

    throw new BadRequestException(`Unknown stage. Choose from: all, ${STAGE_NAMES.join(', ')}`);
  }
}
