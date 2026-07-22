import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import pLimit from 'p-limit';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { readdir } from 'node:fs/promises';

/* Types */
type Timeline = { uuid: string; time: number; type: string };
type Vod = { uuid: string; url: string; startsAt: number };
type BasicMatchData = { id: number; vod: Vod | [] };
type MatchData = {
  id: number;
  date: number;
  timelines: Timeline[];
  vod: Vod[];
  players: { uuid: string; nickname: string }[];
  result: { uuid: string; time: number };
  forfeited: boolean;
};
type DeathEvent = { vodNickname: string; vodTime: string; vodLink: string; eventUnix: number };
type DragonRaceCondition = {
  player: string;
  timeDifferenceSeconds: number;
  vodLink: string;
  date: string;
  eventUnix: number;
};

type ApiResponseData = BasicMatchData[] | MatchData | string;
type ApiResponse = {
  status: 'success' | 'error';
  data: ApiResponseData;
};
type ErrorPayload = {
  error?: string;
  query?: Record<string, string[]>;
  params?: Record<string, string[]>;
};

/* Constants */
const API_MAX_RESULTS = 100; // setting a higher limit when querying all users. most players don't have a public vod
const API_MAX_RESULTS_USER_PAGE = 60;
const VOD_TIMESTAMP_PADDING = 6; // seconds

@Injectable()
export class AppService {
  async getVods(user?: string, before?: number, season?: number, includeOpponent?: boolean) {
    const parsedSeason = this.validateSeason(season);
    const parsedBefore = this.validateBefore(before);
    const validatedUser = this.validateUsername(user);

    const { lastMatchId, matchIds } = await this.getMatchIDs(validatedUser, parsedBefore, parsedSeason);
    const allVods: DeathEvent[] = [];

    const matches = await Promise.all(matchIds.map((id) => this.getMatch(id)));

    for (const match of matches) {
      if (match.vod.length === 0 || match.forfeited) {
        continue;
      }

      const deathTimelines = match.timelines.filter((timeline) => timeline.type === 'projectelo.timeline.death');
      if (deathTimelines.length === 0) {
        continue;
      }

      const uuidToNickname = new Map<string, string>();
      for (const p of match.players) {
        uuidToNickname.set(p.uuid, p.nickname);
      }

      const vodMap = new Map(match.vod.map((v) => [v.uuid, v]));

      const playerEvents = deathTimelines.map((timeline) => ({
        time: timeline.time,
        uuid: timeline.uuid,
      }));

      const filteredEvents =
        includeOpponent || !validatedUser
          ? playerEvents
          : playerEvents.filter((event) => {
              const nickname = uuidToNickname.get(event.uuid);
              return nickname?.toLowerCase() === validatedUser.toLowerCase();
            });

      const vods = filteredEvents
        .map((event) => {
          const vod = vodMap.get(event.uuid);
          if (vod) {
            const { vodTimestamp, date, eventUnix } = this.getTime(match, event.time, vod.startsAt);

            return {
              vodTime: date,
              vodNickname: uuidToNickname.get(event.uuid) || '',
              vodLink: vod.url + '?t=' + (vodTimestamp - VOD_TIMESTAMP_PADDING) + 's',
              eventUnix,
            };
          }
          return null;
        })
        .filter((result): result is DeathEvent => result !== null);

      if (vods.length > 0) {
        allVods.push(...vods);
      }
    }

    return { allVods, lastMatchId, parsedSeason };
  }

  async getVodsForPlayers(playersInput?: string, season?: number, includeOpponent?: boolean) {
    if (!playersInput) {
      throw new BadRequestException('Query "players" is required and must be a comma-separated list of usernames.');
    }

    const players = String(playersInput)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const allVods: DeathEvent[] = [];
    const notFound: string[] = [];
    const notPlayed: string[] = [];

    const limit = pLimit(10);

    const validPlayers = players.filter((p) => !!p);

    const results = await Promise.allSettled(
      validPlayers.map((player) =>
        limit(() =>
          this.getVods(player, undefined, season, includeOpponent).then((resp) => ({
            player,
            resp,
          })),
        ),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const player = validPlayers[i];

      if (result.status === 'fulfilled') {
        const { resp } = result.value;

        if (!resp.lastMatchId) {
          notPlayed.push(player);
        }

        for (const vod of resp.allVods) {
          if (!seen.has(vod.vodLink)) {
            seen.add(vod.vodLink);
            allVods.push(vod);
          }
        }
      } else if (result.reason instanceof NotFoundException) {
        notFound.push(player);
      } else if (result.reason) {
        throw result.reason;
      }
    }

    // Sort by event time (newest first)
    allVods.sort((a, b) => (b.eventUnix || 0) - (a.eventUnix || 0));

    return {
      allVods,
      notFound,
      notPlayed,
    };
  }

  private async getCachedMatch(id: number): Promise<MatchData | null> {
    try {
      const data = await readFile(`./cache/match_${id}.json`, 'utf-8');
      const match = JSON.parse(data) as MatchData;

      this.validateMatchDataResponse(match);
      return match;
    } catch {
      return null;
    }
  }

  private async getLiveMatchAndCache(id: number) {
    const response = await this.makeApiRequest('matches/' + id);
    this.validateMatchDataResponse(response);

    void this.writeToCache(`./cache/match_${id}.json`, response);
    return response;
  }

  private async getMatch(id: number) {
    const cachedMatch = await this.getCachedMatch(id);
    if (cachedMatch) {
      return cachedMatch;
    }

    return this.getLiveMatchAndCache(id);
  }

  private async getMatchIDs(user?: string, before?: number, season?: number) {
    const matchesResponse = await this.makeApiRequest(
      `${user ? `users/${user}/matches` : 'matches'}?count=${user ? API_MAX_RESULTS_USER_PAGE : API_MAX_RESULTS}${before ? `&before=${before}` : ''}&excludeDecayed=true${season ? `&season=${season}` : ''}`,
    );
    this.validateMatchIdResponse(matchesResponse);

    const lastMatchId = matchesResponse[matchesResponse.length - 1]?.id;
    const matchIds = matchesResponse
      .filter((item) => Array.isArray(item.vod) && item.vod.length !== 0)
      .map((item) => item.id);

    return { lastMatchId, matchIds };
  }

  private getTime(match: MatchData, eventTime: number, vodStart: number) {
    const gameStartUnix = match.date - match.result.time / 1000;
    const eventAbsoluteUnix = gameStartUnix + eventTime / 1000; // seconds
    const vodTimestamp = Math.floor(eventAbsoluteUnix - vodStart);

    const date = new Date(eventAbsoluteUnix * 1000).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
    });
    return { vodTimestamp, date, eventUnix: eventAbsoluteUnix };
  }

  private async writeToCache(path: string, response: MatchData) {
    await mkdir('./cache', { recursive: true });
    await writeFile(path, JSON.stringify(response));
  }

  private validateSeason(season?: unknown): number | undefined {
    if (season === undefined || season === '') return undefined;

    const parsed = Number(season);
    if (Number.isNaN(parsed) || parsed < 8) {
      throw new BadRequestException(
        'Season must be a number greater than or equal to 8. The MCSR Ranked API does not include VODs for earlier seasons, and those VODs will have expired by now anyway.',
      );
    }
    return parsed;
  }

  private validateBefore(before?: unknown): number | undefined {
    if (before === undefined || before === '') return undefined;

    const parsed = Number(before);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 2147483647) {
      throw new BadRequestException('Query "before" must be a number greater between 0 and 2147483647.');
    }
    return parsed;
  }

  private validateUsername(username?: string): string | undefined {
    if (username === undefined || username === '') return undefined;

    const minecraftUsernameRegex = /^[a-zA-Z0-9_]{3,16}$/;

    if (!minecraftUsernameRegex.test(username)) {
      throw new BadRequestException(
        'Username must be a valid Minecraft username (3-16 characters, only letters, numbers, and underscores).',
      );
    }

    return username;
  }

  private validateMatchDataResponse(response: any): asserts response is MatchData {
    if (
      typeof response !== 'object' ||
      response === null ||
      typeof (response as MatchData).date !== 'number' || // "redundant" in types, but ensures runtime type safety
      !Array.isArray((response as MatchData).timelines) ||
      !Array.isArray((response as MatchData).vod)
    ) {
      throw new Error('Expected a MatchData object but got: ' + JSON.stringify(response));
    }
  }

  private validateMatchIdResponse(response: ApiResponseData): asserts response is BasicMatchData[] {
    if (
      !Array.isArray(response) ||
      !response.every((item) => typeof item.id === 'number' && typeof item.vod === 'object') // "redundant" in types, but ensures runtime type safety
    ) {
      throw new Error('Expected an array of basic match data but got: ' + JSON.stringify(response));
    }
  }

  private async makeApiRequest(endpoint: string) {
    const response = await fetch('https://api.mcsrranked.com/' + endpoint);
    const responseText = await response.text();

    if (!response.ok && !responseText.startsWith('{')) {
      throw new Error(
        `Network response was not ok for endpoint ${endpoint}. Status: ${response.status} ${response.statusText}. Text: ${responseText}`,
      );
    }
    const responseJson = JSON.parse(responseText) as ApiResponse;

    this.handleResponseError(responseJson, endpoint);
    return responseJson.data;
  }

  private findDragonRaceCondition(match: MatchData): DragonRaceCondition | null {
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

    // Both players did not kill the dragon
    if (!winnerDragonDeath || !loserDragonDeath) {
      return null;
    }

    const uuidToNickname = new Map(match.players.map((p) => [p.uuid, p.nickname]));

    const vod = match.vod.find((v) => v.uuid === loserDragonDeath.uuid);

    // Need VOD for timestamp
    if (!vod) {
      return null;
    }

    const { vodTimestamp, date, eventUnix } = this.getTime(match, loserDragonDeath.time, vod.startsAt);

    return {
      player: uuidToNickname.get(loserDragonDeath.uuid) ?? '',
      timeDifferenceSeconds: Math.abs(loserDragonDeath.time - winnerDragonDeath.time) / 1000,
      vodLink: `${vod.url}?t=${vodTimestamp}s`,
      date,
      eventUnix,
    };
  }

  async getDragonRaceConditions() {
    const conditions: DragonRaceCondition[] = [];

    const files = await readdir('./cache').catch(() => []);

    const matchIds = files
      .filter((file) => /^match_\d+\.json$/.test(file))
      .map((file) => Number(file.match(/\d+/)?.[0]))
      .filter(Boolean);

    for (const id of matchIds) {
      const match = await this.getCachedMatch(id);

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

  private handleResponseError(responseJson: ApiResponse, endpoint: string) {
    if (responseJson.status === 'success') return;

    let message = `API request failed to endpoint ${endpoint}.`;
    const data = responseJson.data;

    if (typeof data === 'object' && data !== null) {
      const { error, query, params } = data as ErrorPayload;

      if (error) {
        if (error === 'This player is not exist.') {
          throw new NotFoundException('This user does not exist.');
        }
        message += ` ${error}`;
      }

      if (query) message += ` Query validation failed: ${JSON.stringify(query)}`;
      if (params) message += ` Parameter validation failed: ${JSON.stringify(params)}`;
    } else if (typeof data === 'string') {
      message += ` ${data}`;
    }

    throw new Error(message);
  }
}
