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

    const matches = await Promise.all(matchIds.map((id) => this.matchService.getCachedMatch(id)));

    const playerEloMap = new Map<string, PlayerEloInfo>();

    for (const match of matches) {
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

    const results = this.buildPlayerEloResults(playerEloMap);

    this.sortPlayerEloResults(results);

    return { players: results };
  }

  private buildPlayerEloResults(playerEloMap: Map<string, PlayerEloInfo>): Array<{
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
        const infoWithHighlight = info as PlayerEloInfo & {
          lastRecordedHighlight: PlayerLastRecordedHighlight;
        };

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

  private sortPlayerEloResults(
    results: Array<{
      player: string;
      elo: number | null;
      rankName: string;
      rankIndex: number;
      rankEmoji?: string;
      season: number;
      lastRecordedHighlight: PlayerLastRecordedHighlight;
    }>,
  ): void {
    results.sort((a, b) => {
      if (a.elo === null && b.elo === null) {
        return a.player.localeCompare(b.player, undefined, {
          sensitivity: 'base',
        });
      }

      if (a.elo === null) return 1;
      if (b.elo === null) return -1;

      return b.elo - a.elo;
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
    const key = player.nickname.trim().toLowerCase();

    let entry = playerEloMap.get(key);

    if (!entry) {
      entry = {
        elo: null,
        seenAt: 0,
        latestMatchId: matchId,
        season,
        lastRecordedHighlight: undefined,
      };

      playerEloMap.set(key, entry);
    }

    if (typeof player.eloRate === 'number' && seenAt > entry.seenAt) {
      entry.elo = player.eloRate;
      entry.seenAt = seenAt;
    }

    if (matchId > entry.latestMatchId) {
      entry.latestMatchId = matchId;
      if (season > 0) entry.season = season;
    }

    const highlight = this.getLatestPlayerHighlight(match, player);

    if (highlight && (!entry.lastRecordedHighlight || highlight.eventUnix > entry.lastRecordedHighlight.eventUnix)) {
      entry.lastRecordedHighlight = highlight;
      entry.latestMatchId = matchId;
      if (season > 0) entry.season = season;
    }
  }

  private getLatestPlayerHighlight(
    match: MatchData,
    player: MatchData['players'][number],
  ): PlayerLastRecordedHighlight | undefined {
    const vod = Array.isArray(match.vod) ? match.vod.find((v) => v.uuid === player.uuid) : undefined;

    if (!vod) return undefined;

    const deathTimelines = Array.isArray(match.timelines)
      ? match.timelines.filter((t) => t.type === 'projectelo.timeline.death' && t.uuid === player.uuid)
      : [];

    if (deathTimelines.length === 0) return undefined;

    const latestDeathEvent = [...deathTimelines].sort((a, b) => b.time - a.time)[0];

    const { vodTimestamp, date, eventUnix } = getVodEventTime(match, latestDeathEvent.time, vod.startsAt);

    return {
      date,
      eventUnix,
      url: `${vod.url}?t=${Math.max(0, vodTimestamp - 6)}s`,
      matchId: typeof match.id === 'number' ? match.id : 0,
    };
  }

  async getLastPublicMatchesForPlayers(
    playersInput?: string,
  ): Promise<{
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
