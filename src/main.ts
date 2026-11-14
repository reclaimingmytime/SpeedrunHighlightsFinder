import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { RenderExceptionFilter } from './filters/render-exception-filter';
import cookieParser from 'cookie-parser';
import hbs from 'hbs';
import { removeExpiredCachedMatches } from './utils/cache';
import { getPageTitle } from './utils/app-view';

async function bootstrap() {
  removeExpiredCachedMatches();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('hbs');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  hbs.registerHelper('eq', function (a, b) {
    return a === b;
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  hbs.registerHelper('navActive', (view, targetView) => (view === targetView ? 'nav-active' : ''));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  hbs.registerHelper('pageTitle', (view, user) => getPageTitle(view, user));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  hbs.registerHelper('or', function (...args) {
    args.pop();
    return args.some(Boolean);
  });

  app.useGlobalFilters(new RenderExceptionFilter());
  app.use(cookieParser());

  const username = process.env.BASIC_AUTH_USER ?? 'admin';
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (password) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const auth = req.headers.authorization;
      const expected = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

      if (auth === expected) {
        return next();
      }

      res.setHeader('WWW-Authenticate', 'Basic realm="Restricted"');
      res.status(401).send('Authentication required.');
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
