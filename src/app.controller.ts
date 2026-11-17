import { Controller, Get, Query, Render, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AppView } from './utils/app-view';
import { FailsService } from './services/fails.service';
import { DragonRaceService } from './services/dragon-race.service';
import { PlayerService } from './services/player.service';
import { OpponentForfeitService } from './services/opponent-forfeit.service';
import { SplitsService } from './services/splits.service';
import { VodService } from './services/vod.service';
import { MAX_SEASON, MIN_SEASON } from './utils/validation';

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
    @Query('seedType') seedType?: string,
    @Req() req?: Request,
  ) {
    if (view === AppView.History || view === AppView.LatestFromHistory) {
      return {
        view,
        season,
        minSeason: MIN_SEASON,
        maxSeason: MAX_SEASON,
      };
    }

    if (view === AppView.DragonRace) {
      const conditions = this.dragonRaceService.getDragonRaceConditions();

      return {
        view,
        dragonRaceConditions: conditions,
      };
    }

    if (view === AppView.Forfeits) {
      const result = this.opponentForfeitService.getOpponentForfeits(stage);

      return {
        view,
        stages: this.opponentForfeitService.stages,
        selectedStage: result.selectedStage,
        opponentForfeits: result.opponentForfeits,
      };
    }

    if (view === AppView.Fails) {
      const result = this.failsService.getFails(stage, rank, type, seedType);

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
        seedTypes: result.seedTypes,
        selectedSeedType: result.selectedSeedType,
      };
    }

    if (view === AppView.Splits) {
      this.splitsService.ensureSplitsUpToDate();

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
      before,
      includeOpponent,
      vods: allVods,
      lastMatchId,
      season: parsedSeason,
      minSeason: MIN_SEASON,
      maxSeason: MAX_SEASON,
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
  lastPublicMatches(@Query('players') players?: string) {
    return this.playerService.getLastPublicMatchesForPlayers(players);
  }

  @Get('api/splits')
  splits(@Req() req: Request) {
    // Intentionally read-only: sorting, paging and filtering must not rebuild cached_splits.
    return this.splitsService.getDataTablePage(req.query as Record<string, unknown>);
  }
}
