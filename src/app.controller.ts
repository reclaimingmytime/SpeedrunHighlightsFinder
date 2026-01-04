import { Get, Controller, Render, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Render('index')
  async root(
    @Query('user') user?: string,
    @Query('before') before?: number,
    @Query('season') season?: number,
  ) {
    const response = await this.appService.getVods(user, before, season);
    return {
      vods: response.allVods,
      lastMatchId: response.lastMatchId,
      season: response.parsedSeason,
      user: user || '',
    };
  }
}
