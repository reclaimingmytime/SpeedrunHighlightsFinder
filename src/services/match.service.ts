import { Injectable } from '@nestjs/common';

import { type MatchData } from '../types';
import { makeApiRequest } from '../utils/api-client';
import { getCached, writeCache } from '../utils/cache';
import { validateMatchDataResponse, validateMatchIdResponse } from '../utils/validation';

const API_MAX_RESULTS = 100;
const API_MAX_RESULTS_USER_PAGE = 60;

@Injectable()
export class MatchService {
  async getCachedMatch(id: number): Promise<MatchData | null> {
    const match = await getCached<MatchData>(`./cache/match_${id}.json`);
    if (!match) return null;
    validateMatchDataResponse(match);
    return match;
  }

  async getLiveMatchAndCache(id: number): Promise<MatchData> {
    const response = await makeApiRequest('matches/' + id);
    validateMatchDataResponse(response);

    void writeCache(`./cache/match_${id}.json`, response);
    return response;
  }

  async getMatch(id: number): Promise<MatchData> {
    const cachedMatch = await this.getCachedMatch(id);
    if (cachedMatch) {
      return cachedMatch;
    }

    return this.getLiveMatchAndCache(id);
  }

  async getMatchIDs(
    user?: string,
    before?: number,
    season?: number,
  ): Promise<{ lastMatchId: number | undefined; matchIds: number[] }> {
    const matchesResponse = await makeApiRequest(
      `${user ? `users/${user}/matches` : 'matches'}?count=${user ? API_MAX_RESULTS_USER_PAGE : API_MAX_RESULTS}${before ? `&before=${before}` : ''}&excludeDecayed=true${season ? `&season=${season}` : ''}`,
    );
    validateMatchIdResponse(matchesResponse);

    const lastMatchId = matchesResponse[matchesResponse.length - 1]?.id;
    const matchIds = matchesResponse
      .filter((item) => Array.isArray(item.vod) && item.vod.length !== 0)
      .map((item) => item.id);

    return { lastMatchId, matchIds };
  }
}
