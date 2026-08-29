import { Controller, Get, Query, Render, Req } from '@nestjs/common';
import { Request } from 'express';

import { DragonRaceService } from './services/dragon-race.service';
import { PlayerService } from './services/player.service';
import { VodService } from './services/vod.service';

@Controller()
export class AppController {
  constructor(
    private readonly vodService: VodService,
    private readonly playerService: PlayerService,
    private readonly dragonRaceService: DragonRaceService,
  ) {}

  @Get()
  @Render('index')
  async root(
    @Query('user') user?: string,
    @Query('before') before?: number,
    @Query('season') season?: number,
    @Query('view') view?: string,
    @Req() req?: Request,
  ) {
    if (view === 'history' || view === 'latestFromHistory') {
      return {
        view,
        season,
      };
    }

    if (view === 'players') {
      const playersElo = await this.playerService.getAllPlayersElo();

      return {
        view,
        playersElo,
      };
    }

    if (view === 'dragonrace') {
      const conditions = await this.dragonRaceService.getDragonRaceConditions();

      return {
        view,
        dragonRaceConditions: conditions,
      };
    }

    const includeOpponent = req?.cookies?.includeOpponent === 'true';

    const { allVods, lastMatchId, parsedSeason } = await this.vodService.getVods(user, before, season, includeOpponent);

    return {
      view: 'latest',
      user: user ?? '',
      includeOpponent,
      vods: allVods,
      lastMatchId,
      season: parsedSeason,
    };
  }

  @Get('api/latest')
  async latest(
    @Query('players') players?: string,
    @Query('season') season?: number,
    @Query('includeOpponent') includeOpponent?: string,
  ) {
    const response = await this.vodService.getVodsForPlayers(players, season, includeOpponent === 'true');

    return {
      vods: response.allVods,
      notFound: response.notFound,
      notPlayed: response.notPlayed,
    };
  }

  @Get('api/lastPublicMatches')
  async lastPublicMatches(@Query('players') players?: string) {
    return this.playerService.getLastPublicMatchesForPlayers(players);
  }
}
