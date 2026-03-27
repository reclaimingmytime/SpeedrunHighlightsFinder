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
    const includeOpponentClips = req?.cookies?.includeOpponentClips === 'true';
    const response = await this.appService.getVods(
      user,
      before,
      season,
      includeOpponentClips,
    );
    return {
      vods: response.allVods,
      lastMatchId: response.lastMatchId,
      season: response.parsedSeason,
      user: user || '',
      includeOpponentClips,
    };
  }
}
