import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { BackgroundMatchSyncService } from './services/background-match-sync.service';
import { FailsService } from './services/fails.service';
import { DragonRaceService } from './services/dragon-race.service';
import { MatchService } from './services/match.service';
import { PlayerService } from './services/player.service';
import { OpponentForfeitService } from './services/opponent-forfeit.service';
import { SplitsService } from './services/splits.service';
import { VodService } from './services/vod.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    MatchService,
    VodService,
    PlayerService,
    DragonRaceService,
    OpponentForfeitService,
    FailsService,
    SplitsService,
    BackgroundMatchSyncService,
  ],
})
export class AppModule {}
