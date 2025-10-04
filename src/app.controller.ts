import { Get, Controller, Render, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Render('index')
  async root(@Query('user') user?: string, @Query('before') before?: number) {
    const response = await this.appService.getVods(user, before);
    return {
      vods: response.allVods,
      lastMatchId: response.lastMatchId,
      user: user || '',
    };
  }
}
