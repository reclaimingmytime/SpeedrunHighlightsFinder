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
  result: { uuid: string | null; time: number };
  forfeited: boolean;
  season: number;
  seedType?: string | null;
};
export type DeathEvent = { vodNickname: string; vodTime: string; vodLink: string; eventUnix: number };
export type DragonRaceCondition = {
  player: string;
  timeDifferenceSeconds: number;
  vodLink: string;
  date: string;
  eventUnix: number;
};
export type OpponentForfeit = {
  player: string;
  stage: DeathStage;
  stageLabel: string;
  forfeitTime: string;
  forfeitTimeSeconds: number;
  vodLink: string;
  date: string;
  eventUnix: number;
};

export type DeathStage =
  'overworld' | 'entered nether' | 'bastion' | 'fortress' | 'finding stronghold' | 'stronghold' | 'end';

export type DeathStageOption = {
  value: DeathStage;
  label: string;
};

export type FailType = 'death' | 'forfeit' | 'reset' | 'draw_vote';

export type FailTypeOption = {
  value: FailType | 'all';
  label: string;
};

export type CachedFail = {
  matchId: number;
  player: string;
  type: FailType;
  typeLabel: string;
  stage: DeathStage;
  stageLabel: string;
  elo: number | null;
  rankName: string;
  rankIndex: number;
  rankEmoji: string;
  date: string;
  eventUnix: number;
  vodLink: string;
};

export type FailCounts = Record<FailType, number>;

export type PlayerLatestElo = {
  elo: number | null;
  seenAt: number;
};

export type FailsResult = {
  selectedStage: string;
  selectedRank: string;
  selectedType: string;
  counts: FailCounts;
  fails: CachedFail[];
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
