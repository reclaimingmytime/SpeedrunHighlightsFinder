import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { MatchService } from './match.service';

const BACKGROUND_SYNC_INTERVAL_MS = 60_000;

@Injectable()
export class BackgroundMatchSyncService implements OnModuleInit, OnApplicationShutdown {
  private syncTimer?: NodeJS.Timeout;

  private isSyncing = false;

  constructor(private readonly matchService: MatchService) {}

  onModuleInit(): void {
    if (process.env.BACKGROUND_MATCH_SYNC_ENABLED !== 'true') {
      return;
    }

    void this.syncNow();
    this.syncTimer = setInterval(() => {
      void this.syncNow();
    }, BACKGROUND_SYNC_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
  }

  async syncNow(): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;

    try {
      const { matchIds } = await this.matchService.getMatchIDs();
      //todo this assumes there are only 10 new matches with VODs every minute, which is not always true. implement a solution that detects
      // if one of the result was a direct cache hit, then stop fetching more (assumes this is running every minute). create a hard cut-off of
      // 100 matches to avoid infinite loops. maybe also implement a "last synced match id" cache to avoid fetching the same matches over and over again.
      const recentMatchIds = matchIds.slice(0, 10);

      await Promise.allSettled(recentMatchIds.map((id) => this.matchService.getMatch(id)));
    } catch (error) {
      console.error('Background match sync failed.', error);
    } finally {
      this.isSyncing = false;
    }
  }
}
