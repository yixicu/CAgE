import type { ModelSelection, ResearchConfigV21 } from '../../contracts/v21.js';

export const v4ModelBindings = ['theorist', 'worker', 'moderator', 'learning', 'report', 'mapMaintenance'] as const;
export const v4ModelLabels = {
  theorist: 'Theorist', worker: 'Optional Worker', moderator: 'Moderator',
  learning: 'Learning', report: 'Post-report research', mapMaintenance: 'Knowledge Map maintenance',
};
export const v4StageOwners = { learning: 'theorist', report: 'moderator', mapMaintenance: 'moderator' } as const;
export type V4Stage = keyof typeof v4StageOwners;

export function stageModel(config: Pick<ResearchConfigV21, 'roleModels' | 'defaultModel'>, stage: V4Stage): ModelSelection | undefined {
  return config.roleModels?.[stage] ?? config.roleModels?.[v4StageOwners[stage]] ?? config.defaultModel;
}
