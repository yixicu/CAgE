import type { ModelSelection, RoleBudget } from '../../../engine/types.js';
import type { StagePassage } from './theory-trial.js';

export interface TheoryRequestV4 {
  nativeHandoff?:import('../../../runtime/native-handoff.js').NativeHandoffPort;
  mapMaintenance?:import('./map-maintenance.js').MapMaintenanceContext;
  purpose: 'assess' | 'construct' | 'challenge' | 'identify' | 'instantiate' | 'scope-review' | 'application-review' | 'probe';
  revision?: 'v4-operation-1' | 'v4-operation-2' | 'v4-operation-3' | 'v4-operation-4' | 'v4-operation-5';
  reportStudy?:import('./post-report.js').PostReportStudyV45;
  rootContext?: import('./theory-revision3.js').RootContextV43;
  target?:{projectId:string;epochId:string;rootId:string;branch:string;premiseRevision:string;obligation:string};
  stages: readonly StagePassage[];
  previous: unknown;
  projectId: string;
  callId: string;
  model: ModelSelection;
  budget: RoleBudget;
  knownTheories: readonly string[];
  watch?: {trialId:string; signal:string; reason:string; anchorStageIds:string[]};
  signal?: AbortSignal;
  onDispatch?: () => void | Promise<void>;
  onUsage?: (usage: { tokens?: number; costUsd?: number }) => void | Promise<void>;
}
