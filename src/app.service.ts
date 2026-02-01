import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

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
  result: { time: number };
};
type DeathEvent = { vodNickname: string; vodTime: string; vodLink: string };

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
const VOD_TIMESTAMP_PADDING = 10; // seconds

@Injectable()
export class AppService {
  async getVods(user?: string, before?: number, season?: number) {
    const parsedSeason = this.validateSeason(season);

    const matchIds = await this.getMatchIDs(user, before, parsedSeason);
    const allVods: DeathEvent[] = [];
    const lastMatchId = matchIds[matchIds.length - 1];

    for (const matchId of matchIds) {
      const match = await this.getMatch(matchId);

      const deathTimelines = match.timelines.filter(
        (timeline) => timeline.type === 'projectelo.timeline.death',
      );
      if (deathTimelines.length === 0) {
        continue;
      }

      const uuidToNickname = Object.fromEntries(
        match.players.map((player) => [player.uuid, player.nickname]),
      );
      const playerEvents = deathTimelines.map((timeline) => ({
        time: timeline.time,
        uuid: timeline.uuid,
      }));

      // For each event, check if there is a VOD for the player and compute the timestamp
      const vods = playerEvents
        .map((event) => {
          const vod = match.vod.find((v) => v.uuid === event.uuid);
          if (vod) {
            const { vodTimestamp, date } = this.getTime(
              match,
              event.time,
              vod.startsAt,
            );

            return {
              vodTime: date,
              vodNickname: uuidToNickname[event.uuid],
              vodLink:
                vod.url + '?t=' + (vodTimestamp - VOD_TIMESTAMP_PADDING) + 's',
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

  private async getMatchIDs(
    user?: string,
    before?: number,
    season?: number,
  ): Promise<number[]> {
    const response = await this.makeApiRequest(
      `${user ? `users/${user}/matches` : 'matches'}?count=${user ? API_MAX_RESULTS_USER_PAGE : API_MAX_RESULTS}${before ? `&before=${before}` : ''}&excludeDecayed=true${season ? `&season=${season}` : ''}`,
    );
    this.validateMatchIdResponse(response);

    return response
      .filter((item) => Array.isArray(item.vod) && item.vod.length !== 0)
      .map((item) => item.id);
  }

  private async getMatch(id: number) {
    const fs = await import('fs/promises');
    const path = `./cache/match_${id}.json`; // validated in validateMatchIdResponse

    try {
      const data = await fs.readFile(path, 'utf-8');
      const match = JSON.parse(data) as MatchData;

      this.validateMatchDataResponse(match);
      return match;
    } catch {
      const response = await this.makeApiRequest('matches/' + id);
      this.validateMatchDataResponse(response);

      await this.writeToCache(fs, path, response);
      return response;
    }
  }

  private getTime(match: MatchData, eventTime: number, vodStart: number) {
    const gameStartUnix = match.date - match.result.time / 1000;
    const eventAbsoluteUnix = gameStartUnix + eventTime / 1000;
    const vodTimestamp = Math.floor(eventAbsoluteUnix - vodStart);

    const date = new Date(eventAbsoluteUnix * 1000).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
    });
    return { vodTimestamp, date };
  }

  private async writeToCache(
    fs: typeof import('fs/promises'),
    path: string,
    response: MatchData,
  ) {
    await fs.mkdir('./cache', { recursive: true });
    await fs.writeFile(path, JSON.stringify(response));
  }

  private validateSeason(season?: unknown): number | undefined {
    if (season === undefined || season === '') return undefined;

    const parsed = Number(season);
    if (Number.isNaN(parsed) || parsed < 8) {
      throw new BadRequestException(
        'Season must be a number greater than or equal to 8. The MCSR Ranked API does not show VODs for earlier seasons.',
      );
    }
    return parsed;
  }

  private validateMatchDataResponse(
    response: any,
  ): asserts response is MatchData {
    if (
      typeof response !== 'object' ||
      response === null ||
      typeof (response as MatchData).date !== 'number' || // "redundant" in types, but ensures runtime type safety
      !Array.isArray((response as MatchData).timelines) ||
      !Array.isArray((response as MatchData).vod)
    ) {
      throw new Error(
        'Expected a MatchData object but got: ' + JSON.stringify(response),
      );
    }
  }

  private validateMatchIdResponse(
    response: ApiResponseData,
  ): asserts response is BasicMatchData[] {
    if (
      !Array.isArray(response) ||
      !response.every(
        (item) => typeof item.id === 'number' && typeof item.vod === 'object',
      ) // "redundant" in types, but ensures runtime type safety
    ) {
      throw new Error(
        'Expected an array of basic match data but got: ' +
          JSON.stringify(response),
      );
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

      if (query)
        message += ` Query validation failed: ${JSON.stringify(query)}`;
      if (params)
        message += ` Parameter validation failed: ${JSON.stringify(params)}`;
    } else if (typeof data === 'string') {
      message += ` ${data}`;
    }

    throw new Error(message);
  }
}
