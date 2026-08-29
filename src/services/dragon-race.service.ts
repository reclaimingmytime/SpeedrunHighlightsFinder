import { Injectable } from '@nestjs/common';

import type { DragonRaceCondition, MatchData } from '../types';
import { getAllCachedMatchIds } from '../utils/cache';
import { getVodEventTime } from '../utils/time';
import { MatchService } from './match.service';

@Injectable()
export class DragonRaceService {
  constructor(private readonly matchService: MatchService) {}

  async getDragonRaceConditions() {
    const conditions: DragonRaceCondition[] = [];

    const matchIds = await getAllCachedMatchIds();

    for (const id of matchIds) {
      const match = await this.matchService.getCachedMatch(id);

      if (!match) {
        continue;
      }

      const condition = this.findDragonRaceCondition(match);

      if (condition) {
        conditions.push(condition);
      }
    }

    return conditions.sort((a, b) => b.eventUnix - a.eventUnix);
  }

  findDragonRaceCondition(match: MatchData): DragonRaceCondition | null {
    if (match.forfeited || match.vod.length === 0) {
      return null;
    }

    const dragonDeaths = match.timelines.filter((timeline) => timeline.type === 'projectelo.timeline.dragon_death');

    if (dragonDeaths.length < 2) {
      return null;
    }

    const winnerUuid = match.result.uuid;
    const winnerDragonDeath = dragonDeaths.find((event) => event.uuid === winnerUuid);
    const loserDragonDeath = dragonDeaths.find((event) => event.uuid !== winnerUuid);

    if (!winnerDragonDeath || !loserDragonDeath) {
      return null;
    }

    const uuidToNickname = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vod = match.vod.find((item) => item.uuid === loserDragonDeath.uuid);

    if (!vod) {
      return null;
    }

    const { vodTimestamp, date, eventUnix } = getVodEventTime(match, loserDragonDeath.time, vod.startsAt);

    return {
      player: uuidToNickname.get(loserDragonDeath.uuid) ?? '',
      timeDifferenceSeconds: Math.abs(loserDragonDeath.time - winnerDragonDeath.time) / 1000,
      vodLink: `${vod.url}?t=${vodTimestamp}s`,
      date,
      eventUnix,
    };
  }
}
