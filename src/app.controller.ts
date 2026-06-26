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
    @Req() req?: Request,
  ) {
    const includeOpponent = req?.cookies?.includeOpponent === 'true';
    const response = await this.appService.getVods(user, before, season, includeOpponent);
    return {
      vods: response.allVods,
      lastMatchId: response.lastMatchId,
      season: response.parsedSeason,
      user: user || '',
      includeOpponent,
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
