import type { MatchData, PlayerLatestElo, Timeline } from '../types';

export function groupTimelinesByUuid(timelines: Timeline[]): Map<string, Timeline[]> {
  const timelinesByUuid = new Map<string, Timeline[]>();

  for (const event of timelines) {
    const events = timelinesByUuid.get(event.uuid) ?? [];
    events.push(event);
    timelinesByUuid.set(event.uuid, events);
  }

  return timelinesByUuid;
}

export function getLatestEloByPlayer(matches: MatchData[]): Map<string, number | null> {
  const eloByPlayer = new Map<string, PlayerLatestElo>();

  for (const match of matches) {
    if (!Array.isArray(match.vod) || match.vod.length === 0) continue;

    for (const player of match.players) {
      if (!player.nickname || player.nickname.trim().toLowerCase() === '[ranked bot]') continue;

      const key = player.nickname.trim().toLowerCase();
      const current = eloByPlayer.get(key) ?? { elo: null, seenAt: 0 };
      if (typeof player.eloRate === 'number' && match.date > current.seenAt) {
        current.elo = player.eloRate;
        current.seenAt = match.date;
      }
      eloByPlayer.set(key, current);
    }
  }

  return new Map(Array.from(eloByPlayer, ([player, info]) => [player, info.elo]));
}
