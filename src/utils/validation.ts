import { BadRequestException } from '@nestjs/common';
import type { MatchData, BasicMatchData, ApiResponseData } from '../types';

export function validateSeason(season?: unknown): number | undefined {
  if (season === undefined || season === '') return undefined;

  const parsed = Number(season);
  if (Number.isNaN(parsed) || parsed < 9) {
    throw new BadRequestException(
      'Season must be a number greater than or equal to 9. The MCSR Ranked API does not include all VODs for earlier seasons, and those VODs will have expired by now anyway.',
    );
  }
  return parsed;
}

export function validateBefore(before?: unknown): number | undefined {
  if (before === undefined || before === '') return undefined;

  const parsed = Number(before);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 2147483647) {
    throw new BadRequestException('Query "before" must be a number greater between 0 and 2147483647.');
  }
  return parsed;
}

export function validateUsername(username?: string): string | undefined {
  if (username === undefined || username === '') return undefined;

  const minecraftUsernameRegex = /^[a-zA-Z0-9_]{3,16}$/;

  if (!minecraftUsernameRegex.test(username)) {
    throw new BadRequestException(
      'Username must be a valid Minecraft username (3-16 characters, only letters, numbers, and underscores).',
    );
  }

  return username;
}

export function validateMatchDataResponse(response: any): asserts response is MatchData {
  if (
    typeof response !== 'object' ||
    response === null ||
    typeof (response as MatchData).date !== 'number' ||
    !Array.isArray((response as MatchData).timelines) ||
    !Array.isArray((response as MatchData).vod)
  ) {
    throw new Error('Expected a MatchData object but got: ' + JSON.stringify(response));
  }
}

export function validateMatchIdResponse(response: ApiResponseData): asserts response is BasicMatchData[] {
  if (
    !Array.isArray(response) ||
    !response.every((item) => typeof item.id === 'number' && typeof item.vod === 'object')
  ) {
    throw new Error('Expected an array of basic match data but got: ' + JSON.stringify(response));
  }
}

export function parseAndValidatePlayers(playersInput?: string): string[] {
  if (!playersInput) {
    throw new BadRequestException('Query "players" is required and must be a comma-separated list of usernames.');
  }

  const players = String(playersInput)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (players.length === 0) {
    throw new BadRequestException('At least one valid username is required.');
  }

  for (const p of players) {
    validateUsername(p);
  }

  return players;
}
