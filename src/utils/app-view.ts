export const AppView = {
  Latest: 'latest',
  LatestFromHistory: 'latestFromHistory',
  History: 'history',
  DragonRace: 'dragonrace',
  Forfeits: 'forfeits',
  Fails: 'fails',
  Splits: 'splits',
} as const;

export type AppView = (typeof AppView)[keyof typeof AppView];

const appViews = new Set<string>(Object.values(AppView));

export function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && appViews.has(value);
}

export function getAppView(value: unknown): AppView {
  if (!isAppView(value)) return AppView.Latest;
  return value;
}
