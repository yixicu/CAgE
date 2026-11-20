import type { UserResourceNetwork } from '../learning/user-resource-inspection.js';
/** User resource loading choices, separate from scientific publication and approval. */
export interface CapabilityItem {
  key: string;
  kind: 'skill' | 'policy' | 'strategy';
  id: string;
  version: string;
  title: string;
  description: string;
  /** Read-only explicit source tags for presentation; absent on legacy projections. */
  subjectTags?: readonly string[];
  origin: 'default' | 'local' | 'reviewed' | 'plugin';
  owner: 'base' | 'theorist' | 'moderator' | 'plugin';
  scope: string;
  enabled: boolean;
  available: boolean;
  /** Current exact source-valid body can be revised by USER, including when disabled. */
  editable?: boolean;
  /** This exact content version was last authored by USER rather than a model. */
  userEdited?: boolean;
  reason?: string;
  limitations: string[];
  /** Present in the active or most recently saved Epoch, independently of next selection. */
  active: boolean;
}
export interface CapabilitiesView {
  revision: string;
  items: CapabilityItem[];
  effective: { policyKey: string; skillKeys: string[]; specializedIds: string[] };
  pending: boolean;
  loopVersion?: string;
}
export type CapabilityUpdate = { expectedRevision: string; projectId?: string } &
  ({ key: string; enabled: boolean; reset?: never } | { reset: true; key?: never; enabled?: never });

/** Coherent USER graph and inventory at one library generation, not scientific exposure. */
export interface CapabilityNetwork extends UserResourceNetwork {
  revision: string;
  capabilities: CapabilitiesView;
}
export interface CapabilityResourceBody { id: string; version: number; title?:string; body: string }
export interface CapabilityResourceEdit { id: string; version: number; expectedRevision: string; body: string; projectId?: string }
export interface CapabilityResourceEditResult { resource: CapabilityResourceBody; network: CapabilityNetwork }
