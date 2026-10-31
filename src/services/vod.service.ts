import { Injectable, NotFoundException } from '@nestjs/common';
import pLimit from 'p-limit';

import type { DeathEvent, MatchData } from '../types';
import { getVodEventTime } from '../utils/time';
import { parseAndValidatePlayers, validateBefore, validateSeason, validateUsername } from '../utils/validation';
import { MatchService } from './match.service';

const VOD_TIMESTAMP_PADDING = 6;
const EXPIRED_MATCHES_MESSAGE = 'Twitch VODs expire after two months, so older matches are unavailable.';

@Injectable()
export class VodService {
  constructor(private readonly matchService: MatchService) {}

  async getVods(user?: string, before?: number, season?: number, includeOpponent?: boolean) {
    const parsedSeason = validateSeason(season);
    const parsedBefore = validateBefore(before);
    const validatedUser = validateUsername(user);

    const { lastMatchId, hasMatches, matchIds } = await this.matchService.getMatchIDs(
      validatedUser,
      parsedBefore,
      parsedSeason,
    );

    const fetchedMatches = await Promise.all(matchIds.map((id) => this.matchService.getMatch(id)));
    const matches = fetchedMatches.filter((match): match is MatchData => match !== null);
    const expiredMatchCount = fetchedMatches.length - matches.length;

    const allVods = matches.flatMap((match) => this.getDeathVodsFromMatch(match, validatedUser, includeOpponent));

    return {
      allVods,
      lastMatchId,
      hasMatches,
      parsedSeason,
      expiredMatchesMessage: expiredMatchCount ? EXPIRED_MATCHES_MESSAGE : undefined,
    };
  }

  async getVodsForPlayers(playersInput?: string, season?: number, includeOpponent?: boolean, before?: number) {
    const players = parseAndValidatePlayers(playersInput);

    const results = await this.getVodsForPlayersConcurrently(players, season, includeOpponent, before);

    const allVods: DeathEvent[] = [];
    const seen = new Set<string>();
    const notFound: string[] = [];
    const notPlayed: string[] = [];
    const pagination: { player: string; before: number | undefined }[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const player = players[i];

      if (result.status === 'fulfilled') {
        const { resp } = result.value;
        pagination.push({ player, before: resp.lastMatchId });

        if (!resp.hasMatches) {
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
      pagination,
    };
  }

  private async getVodsForPlayersConcurrently(
    players: string[],
    season?: number,
    includeOpponent?: boolean,
    before?: number,
  ) {
    const limit = pLimit(10);

    return Promise.allSettled(
      players.map((player) =>
        limit(() =>
          this.getVods(player, before, season, includeOpponent).then((resp) => ({
            player,
            resp,
          })),
        ),
      ),
    );
  }

  private getDeathVodsFromMatch(match: MatchData, validatedUser?: string, includeOpponent?: boolean): DeathEvent[] {
    if (!Array.isArray(match.vod) || match.vod.length === 0) {
      return [];
    }

    const deathTimelines = match.timelines.filter((timeline) => timeline.type === 'projectelo.timeline.death');
    const uuidToNickname = new Map(match.players.map((player) => [player.uuid, player.nickname]));
    const vodByPlayerUuid = new Map(match.vod.map((vod) => [vod.uuid, vod]));
    const filteredEvents = this.filterEventsForUser(deathTimelines, uuidToNickname, validatedUser, includeOpponent);
    const vods = filteredEvents
      .map((event) => this.buildDeathVod(match, event, vodByPlayerUuid, uuidToNickname))
      .filter((result): result is DeathEvent => result !== null);

    vods.push(
      ...this.getResetHighlightsWithoutDeath(
        match,
        deathTimelines,
        vodByPlayerUuid,
        uuidToNickname,
        validatedUser,
        includeOpponent,
      ),
    );

    const forfeitHighlights = this.getForfeitHighlightWithoutDeath(
      match,
      deathTimelines,
      vodByPlayerUuid,
      uuidToNickname,
      validatedUser,
      includeOpponent,
    );
    vods.push(...forfeitHighlights);

    return vods;
  }

  private getResetHighlightsWithoutDeath(
    match: MatchData,
    deathTimelines: MatchData['timelines'],
    vodByPlayerUuid: Map<string, MatchData['vod'][number]>,
    uuidToNickname: Map<string, string>,
    validatedUser?: string,
    includeOpponent?: boolean,
  ): DeathEvent[] {
    const resetTimelines = match.timelines.filter((timeline) => timeline.type === 'projectelo.timeline.reset');

    return resetTimelines
      .filter(
        (reset) =>
          !deathTimelines.some((timeline) => timeline.uuid === reset.uuid && timeline.time <= reset.time) &&
          this.isRequestedPlayer(uuidToNickname.get(reset.uuid), validatedUser, includeOpponent),
      )
      .map((reset) => this.buildDeathVod(match, reset, vodByPlayerUuid, uuidToNickname))
      .filter((highlight): highlight is DeathEvent => highlight !== null);
  }

  private getForfeitHighlightWithoutDeath(
    match: MatchData,
    deathTimelines: MatchData['timelines'],
    vodByPlayerUuid: Map<string, MatchData['vod'][number]>,
    uuidToNickname: Map<string, string>,
    validatedUser?: string,
    includeOpponent?: boolean,
  ): DeathEvent[] {
    if (!match.forfeited) {
      return [];
    }

    const isDraw = match.result.uuid === null;
    const candidatePlayers = isDraw
      ? match.players
      : match.players.filter((player) => player.uuid !== match.result.uuid).slice(0, 1);

    return candidatePlayers
      .filter(
        (player) =>
          !deathTimelines.some((timeline) => timeline.uuid === player.uuid && timeline.time <= match.result.time) &&
          this.isRequestedPlayer(uuidToNickname.get(player.uuid), validatedUser, includeOpponent),
      )
      .map((player) =>
        this.buildDeathVod(match, { uuid: player.uuid, time: match.result.time }, vodByPlayerUuid, uuidToNickname),
      )
      .filter((highlight): highlight is DeathEvent => highlight !== null);
  }

  private isRequestedPlayer(nickname?: string, validatedUser?: string, includeOpponent?: boolean): boolean {
    return includeOpponent || !validatedUser || nickname?.toLowerCase() === validatedUser.toLowerCase();
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
