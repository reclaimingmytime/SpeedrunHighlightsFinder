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
    const response = await this.appService.getVods(
      user,
      before,
      season,
      includeOpponent,
    );
    return {
      vods: response.allVods,
      lastMatchId: response.lastMatchId,
      season: response.parsedSeason,
      user: user || '',
      includeOpponent,
    };
  }

  // JSON endpoint to fetch latest matches for a single user (used by client-side history lookup)
  @Get('api/latest')
  async latest(
    @Query('user') user?: string,
    @Query('season') season?: number,
    @Query('includeOpponent') includeOpponent?: string,
  ) {
    const include = includeOpponent === 'true';
    const response = await this.appService.getVods(user, undefined, season, include);
    return {
      vods: response.allVods,
      user: user || '',
      season: response.parsedSeason,
    };
  }
}
