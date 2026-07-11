import { Get, Controller, Render, Query, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { Request } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Render('index')
  async root(
    @Query('user') user?: string,
    @Query('before') before?: number,
    @Query('season') season?: number,
    @Query('view') view?: string,
    @Req() req?: Request,
  ) {
    const includeOpponent = req?.cookies?.includeOpponent === 'true';

    const mode = view === 'history' || view === 'latestFromHistory' ? view : 'latest';

    const base = {
      view: mode,
      user: user ?? '',
      season,
      includeOpponent,
      isHistory: mode === 'history',
      isLatestFromHistory: mode === 'latestFromHistory',
      isLatest: mode === 'latest',
    };

    if (mode !== 'latest') return base;

    const { allVods, lastMatchId, parsedSeason } = await this.appService.getVods(user, before, season, includeOpponent);

    return {
      ...base,
      vods: allVods,
      lastMatchId,
      season: parsedSeason,
    };
  }

  // JSON endpoint to fetch latest matches for a single user or multiple players (used by client-side history lookup)
  @Get('api/latest')
  async latest(
    @Query('user') user?: string,
    @Query('players') players?: string,
    @Query('season') season?: number,
    @Query('includeOpponent') includeOpponent?: string,
  ) {
    const include = includeOpponent === 'true';

    if (players) {
      const playersArray = String(players)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const response = await this.appService.getVodsForPlayers(playersArray, season, include);
      return {
        vods: response.allVods,
        players: playersArray,
        season: response.parsedSeason,
        notFound: response.notFound,
        notPlayed: response.notPlayed,
      };
    }

    // Fall back to single-user behavior for backward compatibility
    const response = await this.appService.getVods(user, undefined, season, include);
    return {
      vods: response.allVods,
      user: user || '',
      season: response.parsedSeason,
    };
  }
}
