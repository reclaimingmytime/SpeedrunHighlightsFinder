import type { MatchData } from '../types';

export function getVodEventTime(match: MatchData, eventTime: number, vodStart: number) {
  const gameStartUnix = match.date - match.result.time / 1000;
  const eventAbsoluteUnix = gameStartUnix + eventTime / 1000;
  const vodTimestamp = Math.floor(eventAbsoluteUnix - vodStart);

  const date = new Date(eventAbsoluteUnix * 1000).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
  });

  return { vodTimestamp, date, eventUnix: eventAbsoluteUnix };
}
