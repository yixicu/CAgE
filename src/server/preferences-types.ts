import type { ModelSelection, ResearchConfig } from '../research/contracts/v1.js';
import type { ResearchConfigV21 } from '../research/contracts/v21.js';
import type { ResearchConfigV2 } from '../research/contracts/v2.js';
export interface AppPreferences {
  maintenanceModel?: ModelSelection;
  defaultModel?: ModelSelection;
  learningFallbackModels?: ModelSelection[];
  researchDefaults?: { '0'?: ResearchConfigV2; '1.0'?: ResearchConfig; '2.0'?: ResearchConfigV2; '2.1'?: ResearchConfigV21; '3.0'?: ResearchConfigV21; '4.0'?: ResearchConfigV21 };
}
