import { BadRequestException, Injectable } from '@nestjs/common';

import { getAllCachedMatchIds } from '../utils/cache';
import { parseAndValidatePlayers } from '../utils/validation';
import { MatchService } from './match.service';

@Injectable()
export class PlayerService {
  constructor(private readonly matchService: MatchService) {}

  async getLastPublicMatchesForPlayers(playersInput?: string): Promise<{
    latestStreamed: Record<string, string | null>;
    latestAll: Record<string, string | null>;
  }> {
    if (!playersInput) {
      throw new BadRequestException('Query "players" is required and must be comma-separated list of usernames.');
    }

    const players = parseAndValidatePlayers(playersInput);

    const matchIds = await getAllCachedMatchIds();

    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));

    const latestStreamed: Record<string, string | null> = {};
    const latestAll: Record<string, string | null> = {};

    for (const player of players) {
      latestStreamed[player] = null;
      latestAll[player] = null;
    }

    for (const match of matches) {
      if (!match) continue;

      const matchPlayers = Array.isArray(match.players) ? match.players : [];
      const vods = Array.isArray(match.vod) ? match.vod : [];
      let matchIso: string | undefined;

      for (const player of players) {
        const matchPlayer = matchPlayers.find(
          (matchPlayer) => matchPlayer.nickname && matchPlayer.nickname.toLowerCase() === player.toLowerCase(),
        );

        if (!matchPlayer) continue;

        matchIso ??= new Date(match.date * 1000).toISOString();
        const existingLatest = latestAll[player];
        if (!existingLatest || matchIso > existingLatest) {
          latestAll[player] = matchIso;
        }

        if (!vods.some((vod) => vod && vod.uuid === matchPlayer.uuid)) continue;

        const existing = latestStreamed[player];
        if (!existing || matchIso > existing) {
          latestStreamed[player] = matchIso;
        }
      }
    }

    return { latestStreamed, latestAll };
  }
}
