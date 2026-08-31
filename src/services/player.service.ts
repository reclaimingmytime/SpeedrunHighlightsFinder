import { BadRequestException, Injectable } from '@nestjs/common';

import { getAllCachedMatchIds } from '../utils/cache';
import type { MatchData, PlayerEloInfo, PlayerLastRecordedHighlight } from '../types';
import { getRankFromElo } from '../utils/ranking';
import { getVodEventTime } from '../utils/time';
import { parseAndValidatePlayers } from '../utils/validation';
import { MatchService } from './match.service';

@Injectable()
export class PlayerService {
  constructor(private readonly matchService: MatchService) {}

  async getAllPlayersElo(): Promise<{
    players: Array<{
      player: string;
      elo: number | null;
      rankName: string;
      rankIndex: number;
      rankEmoji?: string;
      season: number;
      lastRecordedHighlight: PlayerLastRecordedHighlight;
    }>;
  }> {
    const matchIds = await getAllCachedMatchIds();

    const playerEloMap = new Map<string, PlayerEloInfo>();

    for (const id of matchIds) {
      const match = await this.matchService.getCachedMatch(id);
      if (!match) continue;
      if (!Array.isArray(match.vod) || match.vod.length === 0) continue;

      const seenAt = typeof match.date === 'number' ? match.date : 0;
      const matchId = typeof match.id === 'number' ? match.id : 0;
      const season = typeof match.season === 'number' ? match.season : 0;

      for (const player of match.players) {
        if (!player.nickname) continue;
        const name = player.nickname.trim();
        if (name.toLowerCase() === '[ranked bot]') continue;

        this.updatePlayerFromMatch(playerEloMap, player, match, seenAt, matchId, season);
      }
    }

    const results = this.buildResults(playerEloMap);

    results.sort((a, b) => {
      if (a.elo === null && b.elo === null) {
        return a.player.localeCompare(b.player, undefined, { sensitivity: 'base' });
      }
      if (a.elo === null) return 1;
      if (b.elo === null) return -1;
      return b.elo - a.elo;
    });

    return { players: results };
  }

  private buildResults(playerEloMap: Map<string, PlayerEloInfo>): Array<{
    player: string;
    elo: number | null;
    rankName: string;
    rankIndex: number;
    rankEmoji?: string;
    season: number;
    lastRecordedHighlight: PlayerLastRecordedHighlight;
  }> {
    return Array.from(playerEloMap.entries())
      .filter(([, info]) => info.lastRecordedHighlight != null)
      .map(([player, info]) => {
        const infoWithHighlight = info as PlayerEloInfo & { lastRecordedHighlight: PlayerLastRecordedHighlight };
        const { rankName, rankIndex, rankEmoji } = getRankFromElo(infoWithHighlight.elo);
        return {
          player,
          elo: infoWithHighlight.elo,
          rankName,
          rankIndex,
          rankEmoji,
          season: infoWithHighlight.season,
          lastRecordedHighlight: infoWithHighlight.lastRecordedHighlight,
        };
      });
  }

  private updatePlayerFromMatch(
    playerEloMap: Map<string, PlayerEloInfo>,
    player: MatchData['players'][number],
    match: MatchData,
    seenAt: number,
    matchId: number,
    season: number,
  ): void {
    const name = player.nickname.trim();
    let entry = playerEloMap.get(name);

    if (typeof player.eloRate === 'number') {
      if (!entry || entry.seenAt < seenAt) {
        entry = {
          elo: player.eloRate,
          seenAt,
          latestMatchId: matchId,
          season,
          lastRecordedHighlight: entry?.lastRecordedHighlight,
        };
        playerEloMap.set(name, entry);
      }
    } else if (!entry) {
      entry = {
        elo: null,
        seenAt: 0,
        latestMatchId: matchId,
        season,
        lastRecordedHighlight: undefined,
      };
      playerEloMap.set(name, entry);
    }

    if (matchId > entry.latestMatchId) {
      entry.latestMatchId = matchId;
      entry.season = season > 0 ? season : entry.season;
    }

    const vod = Array.isArray(match.vod) ? match.vod.find((v) => v.uuid === player.uuid) : undefined;
    if (!vod) return;

    const deathTimelines = Array.isArray(match.timelines)
      ? match.timelines.filter((t) => t.type === 'projectelo.timeline.death' && t.uuid === player.uuid)
      : [];

    if (deathTimelines.length === 0) return;

    const latestDeathEvent = [...deathTimelines].sort((a, b) => b.time - a.time)[0];

    const { vodTimestamp, date, eventUnix } = getVodEventTime(match, latestDeathEvent.time, vod.startsAt);

    const candidate: PlayerLastRecordedHighlight = {
      date,
      eventUnix,
      url: `${vod.url}?t=${Math.max(0, vodTimestamp - 6)}s`,
      matchId,
    };

    if (!entry.lastRecordedHighlight || eventUnix > entry.lastRecordedHighlight.eventUnix) {
      entry.lastRecordedHighlight = candidate;
      entry.latestMatchId = matchId;
      entry.season = season > 0 ? season : entry.season;
    }
  }

  async getLastPublicMatchesForPlayers(playersInput?: string): Promise<{ results: Record<string, string | null> }> {
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
