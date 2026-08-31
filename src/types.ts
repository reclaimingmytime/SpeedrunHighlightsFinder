export type Timeline = { uuid: string; time: number; type: string };
export type Vod = { uuid: string; url: string; startsAt: number };
export type BasicMatchData = { id: number; vod: Vod };
export type MatchData = {
  id: number;
  date: number;
  timelines: Timeline[];
  vod: Vod[];
  players: {
    uuid: string;
    nickname: string;
    eloRate?: number;
  }[];
  result: { uuid: string; time: number };
  forfeited: boolean;
  season: number;
};
export type DeathEvent = { vodNickname: string; vodTime: string; vodLink: string; eventUnix: number };
export type DragonRaceCondition = {
  player: string;
  timeDifferenceSeconds: number;
  vodLink: string;
  date: string;
  eventUnix: number;
};

export type ApiResponseData = BasicMatchData[] | MatchData | string;
export type ApiResponse = {
  status: 'success' | 'error';
  data: ApiResponseData;
};
export type ErrorPayload = {
  error?: string;
  query?: Record<string, string[]>;
  params?: Record<string, string[]>;
};

export type PlayerLastRecordedHighlight = {
  date: string;
  eventUnix: number;
  url: string;
  matchId?: number;
};

export type PlayerEloInfo = {
  elo: number | null;
  seenAt: number;
  latestMatchId: number;
  season: number;
  lastRecordedHighlight?: PlayerLastRecordedHighlight;
};
