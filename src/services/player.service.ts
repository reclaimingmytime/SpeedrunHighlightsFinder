import { BadRequestException, Injectable } from '@nestjs/common';

import { getAllCachedMatchIds } from '../utils/cache';
import { getRankFromElo } from '../utils/ranking';
import { parseAndValidatePlayers } from '../utils/validation';
import { MatchService } from './match.service';

@Injectable()
export class PlayerService {
  constructor(private readonly matchService: MatchService) {}

  async getAllPlayersElo() {
    const matchIds = await getAllCachedMatchIds();

    const map = new Map<string, { elo: number | null; seenAt: number }>();

    for (const id of matchIds) {
      const match = await this.matchService.getCachedMatch(id);
      if (!match) continue;

      if (!Array.isArray(match.vod) || match.vod.length === 0) continue;

      const seenAt = typeof match.date === 'number' ? match.date : 0;

      for (const player of match.players) {
        if (!player.nickname) continue;
        const name = player.nickname.trim();

        if (name.toLowerCase() === '[ranked bot]') continue;

        const hasVodForPlayer = Array.isArray(match.vod) && match.vod.some((vod) => vod.uuid === player.uuid);
        if (!hasVodForPlayer) continue;

        const eloFromMatch = player.eloRate;

        const existing = map.get(name);
        if (typeof eloFromMatch === 'number') {
          if (!existing || existing.seenAt < seenAt) {
            map.set(name, { elo: eloFromMatch, seenAt });
          }
        } else if (!existing) {
          map.set(name, { elo: null, seenAt: 0 });
        }
      }
    }

    const results: { player: string; elo: number | null; rankName: string; rankIndex: number; rankEmoji: string }[] =
      Array.from(map.entries()).map(([player, info]) => {
        const elo = info.elo;
        const { rankName, rankIndex, rankEmoji } = getRankFromElo(elo);
        return { player, elo, rankName, rankIndex, rankEmoji };
      });

    results.sort((a, b) => {
      if (a.elo === null && b.elo === null) return a.player.localeCompare(b.player, undefined, { sensitivity: 'base' });
      if (a.elo === null) return 1;
      if (b.elo === null) return -1;
      return b.elo - a.elo;
    });

    return { players: results };
  }

  async getLastPublicMatchesForPlayers(playersInput?: string) {
    if (!playersInput) {
      throw new BadRequestException('Query "players" is required and must be comma-separated list of usernames.');
    }

    const players = parseAndValidatePlayers(playersInput);

    const matchIds = await getAllCachedMatchIds();

    const results: Record<string, string | null> = {};
    for (const player of players) results[player] = null;

    for (const id of matchIds) {
      const match = await this.matchService.getCachedMatch(id);
      if (!match) continue;
      if (!Array.isArray(match.vod) || match.vod.length === 0) continue;

      for (const player of players) {
        const found = match.players.some((matchPlayer) => matchPlayer.nickname.toLowerCase() === player.toLowerCase());
        if (!found) continue;

        const existing = results[player];
        const matchIso = new Date(match.date * 1000).toISOString();
        if (!existing || matchIso > existing) {
          results[player] = matchIso;
        }
      }
    }

    return { results };
  }
}
