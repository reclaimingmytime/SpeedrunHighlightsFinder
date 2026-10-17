import { Controller, Get, Query, Render, Req } from '@nestjs/common';
import { Request } from 'express';

import { DeathsService } from './services/deaths.service';
import { DragonRaceService } from './services/dragon-race.service';
import { PlayerService } from './services/player.service';
import { SplitsService } from './services/splits.service';
import { VodService } from './services/vod.service';

@Controller()
export class AppController {
  constructor(
    private readonly vodService: VodService,
    private readonly playerService: PlayerService,
    private readonly dragonRaceService: DragonRaceService,
    private readonly deathsService: DeathsService,
    private readonly splitsService: SplitsService,
  ) {}

  @Get()
  @Render('index')
  async root(
    @Query('user') user?: string,
    @Query('before') before?: number,
    @Query('season') season?: number,
    @Query('view') view?: string,
    @Query('stage') stage?: string,
    @Query('rank') rank?: string,
    @Req() req?: Request,
  ) {
    if (view === 'history' || view === 'latestFromHistory') {
      return {
        view,
        season,
      };
    }

    if (view === 'dragonrace') {
      const conditions = await this.dragonRaceService.getDragonRaceConditions();

      return {
        view,
        dragonRaceConditions: conditions,
      };
    }

    if (view === 'deaths') {
      const result = await this.deathsService.getDeaths(stage, rank);
      return {
        view,
        stages: this.deathsService.stages,
        ranks: this.deathsService.ranks,
        selectedStage: result.selectedStage,
        selectedRank: result.selectedRank,
        deaths: result.deaths,
      };
    }

    if (view === 'splits') {
      return { view };
    }

    const includeOpponent = req?.cookies?.includeOpponent === 'true';

    const { allVods, lastMatchId, parsedSeason, expiredMatchesMessage } = await this.vodService.getVods(
      user,
      before,
      season,
      includeOpponent,
    );

    return {
      view: 'latest',
      user: user ?? '',
      includeOpponent,
      vods: allVods,
      lastMatchId,
      season: parsedSeason,
      expiredMatchesMessage,
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
      expiredMatchesMessage: response.expiredMatchesMessage,
    };
  }

  @Get('api/lastPublicMatches')
  async lastPublicMatches(@Query('players') players?: string) {
    return this.playerService.getLastPublicMatchesForPlayers(players);
  }

  @Get('api/splits')
  async splits(@Req() req: Request) {
    return this.splitsService.getDataTablePage(req.query);
  }
}
