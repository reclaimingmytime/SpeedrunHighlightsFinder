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

      // compute latest match date regardless of vod
      for (const player of players) {
        const matchPlayer = Array.isArray(match.players)
          ? match.players.find((mp) => mp.nickname && mp.nickname.toLowerCase() === player.toLowerCase())
          : undefined;

        if (!matchPlayer) continue;

        const matchIso = new Date(match.date * 1000).toISOString();
        const existingLatest = latestAll[player];
        if (!existingLatest || matchIso > existingLatest) {
          latestAll[player] = matchIso;
        }
      }

      // skip matches without vod for streamed results
      if (!Array.isArray(match.vod) || match.vod.length === 0) continue;

      for (const player of players) {
        // Find the player object in this match (case-insensitive)
        const matchPlayer = Array.isArray(match.players)
          ? match.players.find((mp) => mp.nickname && mp.nickname.toLowerCase() === player.toLowerCase())
          : undefined;

        if (!matchPlayer) continue;

        // Ensure there's a VOD entry for this specific player UUID
        const vodForPlayer = Array.isArray(match.vod)
          ? match.vod.find((v) => v && v.uuid === matchPlayer.uuid)
          : undefined;

        if (!vodForPlayer) continue;

        const existing = latestStreamed[player];
        const matchIso = new Date(match.date * 1000).toISOString();

        if (!existing || matchIso > existing) {
          latestStreamed[player] = matchIso;
        }
      }
    }

    return { latestStreamed, latestAll };
  }
}
