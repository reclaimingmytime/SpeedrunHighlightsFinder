import { Injectable, NotFoundException } from '@nestjs/common';
import pLimit from 'p-limit';

import type { DeathEvent, MatchData } from '../types';
import { getVodEventTime } from '../utils/time';
import { parseAndValidatePlayers, validateBefore, validateSeason, validateUsername } from '../utils/validation';
import { MatchService } from './match.service';

const VOD_TIMESTAMP_PADDING = 6;

@Injectable()
export class VodService {
  constructor(private readonly matchService: MatchService) {}

  async getVods(user?: string, before?: number, season?: number, includeOpponent?: boolean) {
    const parsedSeason = validateSeason(season);
    const parsedBefore = validateBefore(before);
    const validatedUser = validateUsername(user);

    const { lastMatchId, matchIds } = await this.matchService.getMatchIDs(validatedUser, parsedBefore, parsedSeason);

    const matches = await Promise.all(matchIds.map((id) => this.matchService.getMatch(id)));

    const allVods = matches.flatMap((match) => this.getDeathVodsFromMatch(match, validatedUser, includeOpponent));

    return {
      allVods,
      lastMatchId,
      parsedSeason,
    };
  }

  async getVodsForPlayers(playersInput?: string, season?: number, includeOpponent?: boolean) {
    const players = parseAndValidatePlayers(playersInput);

    const results = await this.getVodsForPlayersConcurrently(players, season, includeOpponent);

    const allVods: DeathEvent[] = [];
    const seen = new Set<string>();
    const notFound: string[] = [];
    const notPlayed: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const player = players[i];

      if (result.status === 'fulfilled') {
        const { resp } = result.value;

        if (!resp.lastMatchId) {
          notPlayed.push(player);
        }

        for (const vod of resp.allVods) {
          if (seen.has(vod.vodLink)) {
            continue;
          }

          seen.add(vod.vodLink);
          allVods.push(vod);
        }
      } else if (result.reason instanceof NotFoundException) {
        notFound.push(player);
      } else {
        throw result.reason;
      }
    }

    allVods.sort((a, b) => (b.eventUnix || 0) - (a.eventUnix || 0));

    return {
      allVods,
      notFound,
      notPlayed,
    };
  }

  private async getVodsForPlayersConcurrently(players: string[], season?: number, includeOpponent?: boolean) {
    const limit = pLimit(10);

    return Promise.allSettled(
      players.map((player) =>
        limit(() =>
          this.getVods(player, undefined, season, includeOpponent).then((resp) => ({
            player,
            resp,
          })),
        ),
      ),
    );
  }

  private getDeathVodsFromMatch(match: MatchData, validatedUser?: string, includeOpponent?: boolean): DeathEvent[] {
    if (match.vod.length === 0 || match.forfeited) {
      return [];
    }

    const deathTimelines = match.timelines.filter((timeline) => timeline.type === 'projectelo.timeline.death');

    if (deathTimelines.length === 0) {
      return [];
    }

    const uuidToNickname = new Map(match.players.map((player) => [player.uuid, player.nickname]));

    const vodByPlayerUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));

    const filteredEvents = this.filterEventsForUser(deathTimelines, uuidToNickname, validatedUser, includeOpponent);

    return filteredEvents
      .map((event) => this.buildDeathVod(match, event, vodByPlayerUuid, uuidToNickname))
      .filter((result): result is DeathEvent => result !== null);
  }

  private filterEventsForUser(
    events: { time: number; uuid: string }[],
    uuidToNickname: Map<string, string>,
    validatedUser?: string,
    includeOpponent?: boolean,
  ) {
    if (includeOpponent || !validatedUser) {
      return events;
    }

    const normalizedUser = validatedUser.toLowerCase();

    return events.filter((event) => {
      const nickname = uuidToNickname.get(event.uuid);
      return nickname?.toLowerCase() === normalizedUser;
    });
  }

  private buildDeathVod(
    match: MatchData,
    event: { time: number; uuid: string },
    vodByPlayerUuid: Map<string, MatchData['vod'][number]>,
    uuidToNickname: Map<string, string>,
  ): DeathEvent | null {
    const vod = vodByPlayerUuid.get(event.uuid);

    if (!vod) {
      return null;
    }

    const { vodTimestamp, date, eventUnix } = getVodEventTime(match, event.time, vod.startsAt);

    return {
      vodTime: date,
      vodNickname: uuidToNickname.get(event.uuid) ?? '',
      vodLink: `${vod.url}?t=${vodTimestamp - VOD_TIMESTAMP_PADDING}s`,
      eventUnix,
    };
  }
}
