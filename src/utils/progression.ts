import type { DeathStage } from '../types';

export const STAGE_NAMES = [
  'overworld',
  'entered nether',
  'bastion',
  'fortress',
  'finding stronghold',
  'stronghold',
  'end',
] as const satisfies readonly DeathStage[];

export const PROGRESSION_EVENTS = new Map<string, number>([
  ['story.enter_the_nether', 1],
  ['nether.find_bastion', 2],
  ['nether.loot_bastion', 2],
  ['nether.find_fortress', 3],
  ['nether.obtain_blaze_rod', 3],
  ['projectelo.timeline.blind_travel', 4],
  ['story.follow_ender_eye', 5],
  ['story.enter_the_end', 6],
  ['end.root', 6],
]);

export function getStageAtTime(
  timelines: { uuid: string; time: number; type: string }[],
  playerUuid: string,
  time: number,
): DeathStage {
  const stageIndex = timelines.reduce((furthestStage, timeline) => {
    if (timeline.uuid !== playerUuid || timeline.time > time) return furthestStage;
    return Math.max(furthestStage, PROGRESSION_EVENTS.get(timeline.type) ?? 0);
  }, 0);
  return STAGE_NAMES[stageIndex];
}

export function formatStageLabel(stage: DeathStage): string {
  return stage
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
