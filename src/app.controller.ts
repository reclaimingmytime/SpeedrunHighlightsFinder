import { Get, Controller, Render, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Render('index')
  async root(@Query('user') user?: string) {
    return {
      vods: await this.appService.getVods(user),
      user: user || '',
    };
  }
}
