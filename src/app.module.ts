import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DragonRaceService } from './services/dragon-race.service';
import { MatchService } from './services/match.service';
import { PlayerService } from './services/player.service';
import { VodService } from './services/vod.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [MatchService, VodService, PlayerService, DragonRaceService],
})
export class AppModule {}
