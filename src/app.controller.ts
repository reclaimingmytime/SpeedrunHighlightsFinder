import { Controller, Get, Query, Render, Req } from '@nestjs/common';
import { Request } from 'express';

import { AppView } from './utils/app-view';
import { FailsService } from './services/fails.service';
import { DragonRaceService } from './services/dragon-race.service';
import { PlayerService } from './services/player.service';
import { OpponentForfeitService } from './services/opponent-forfeit.service';
import { SplitsService } from './services/splits.service';
import { VodService } from './services/vod.service';

@Controller()
export class AppController {
  constructor(
    private readonly vodService: VodService,
    private readonly playerService: PlayerService,
    private readonly dragonRaceService: DragonRaceService,
    private readonly opponentForfeitService: OpponentForfeitService,
    private readonly failsService: FailsService,
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
    @Query('type') type?: string,
    @Req() req?: Request,
  ) {
    if (view === AppView.History || view === AppView.LatestFromHistory) {
      return {
        view,
        season,
      };
    }

    if (view === AppView.DragonRace) {
      const conditions = await this.dragonRaceService.getDragonRaceConditions();

      return {
        view,
        dragonRaceConditions: conditions,
      };
    }

    if (view === AppView.Forfeits) {
      const result = await this.opponentForfeitService.getOpponentForfeits(stage);
      return {
        view,
        stages: this.opponentForfeitService.stages,
        selectedStage: result.selectedStage,
        opponentForfeits: result.opponentForfeits,
      };
    }

    if (view === AppView.Fails || view === AppView.Deaths) {
      const result = await this.failsService.getFails(stage, rank, type);
      return {
        view: AppView.Fails,
        stages: this.failsService.stages,
        ranks: this.failsService.ranks,
        failTypes: this.failsService.failTypes,
        selectedStage: result.selectedStage,
        selectedRank: result.selectedRank,
        selectedType: result.selectedType,
        failCounts: result.counts,
        fails: result.fails,
      };
    }

    if (view === AppView.Splits) {
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
      view: AppView.Latest,
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
    @Query('before') before?: number,
  ) {
    const response = await this.vodService.getVodsForPlayers(players, season, includeOpponent === 'true', before);

    return {
      vods: response.allVods,
      notFound: response.notFound,
      notPlayed: response.notPlayed,
      pagination: response.pagination,
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
