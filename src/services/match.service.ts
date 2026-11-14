import { Injectable } from '@nestjs/common';

import { type MatchData } from '../types';
import { makeApiRequest } from '../utils/api-client';
import { getCached, isMatchOlderThanTwoMonths, removeExpiredMatchCache, writeCache } from '../utils/cache';
import { validateMatchDataResponse, validateMatchIdResponse } from '../utils/validation';

const API_MAX_RESULTS = 100;
const API_MAX_RESULTS_USER_PAGE = 60;

@Injectable()
export class MatchService {
  private readCachedMatch(id: number): { match: MatchData | null; expired: boolean } {
    const match = getCached<MatchData>(`./cache/match_${id}.json`);
    if (!match) return { match: null, expired: false };
    validateMatchDataResponse(match);
    if (isMatchOlderThanTwoMonths(match.date)) {
      removeExpiredMatchCache(id, 'match lookup');
      return { match: null, expired: true };
    }
    return { match, expired: false };
  }

  getCachedMatch(id: number): MatchData | null {
    return this.readCachedMatch(id).match;
  }

  async getLiveMatchAndCache(id: number): Promise<MatchData | null> {
    const response = await makeApiRequest('matches/' + id);
    validateMatchDataResponse(response);

    if (isMatchOlderThanTwoMonths(response.date)) {
      removeExpiredMatchCache(id, 'match lookup');
      return null;
    }

    void writeCache(`./cache/match_${id}.json`, response);
    return response;
  }

  async getMatch(id: number): Promise<MatchData | null> {
    const cached = this.readCachedMatch(id);
    if (cached.expired) return null;
    if (cached.match) return cached.match;

    return this.getLiveMatchAndCache(id);
  }

  async getMatchIDs(
    user?: string,
    before?: number,
    season?: number,
  ): Promise<{ lastMatchId: number | undefined; hasMatches: boolean; matchIds: number[] }> {
    const count = user ? API_MAX_RESULTS_USER_PAGE : API_MAX_RESULTS;
    const requestPath = `${user ? `users/${user}/matches` : 'matches'}?count=${count}${before ? `&before=${before}` : ''}&excludeDecayed=true${season ? `&season=${season}` : ''}`;
    const matchesResponse = await makeApiRequest(requestPath);

    validateMatchIdResponse(matchesResponse);

    const hasMatches = matchesResponse.length > 0;
    const lastMatchId = matchesResponse.length === count ? matchesResponse[matchesResponse.length - 1]?.id : undefined;
    const matchIds = matchesResponse
      .filter((item) => Array.isArray(item.vod) && item.vod.length !== 0)
      .map((item) => item.id);

    return { lastMatchId, hasMatches, matchIds };
  }
}
