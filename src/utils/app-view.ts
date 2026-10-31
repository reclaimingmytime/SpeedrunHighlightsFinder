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

export function convertToTitleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getPageTitle(view: unknown, user: unknown): string {
  const viewTitle = isAppView(view) ? convertToTitleCase(getAppView(view)) : '';
  const prefix = typeof user === 'string' && user ? user : viewTitle;

  return prefix ? `${prefix} - MCSR Ranked Highlights` : 'MCSR Ranked Highlights';
}
