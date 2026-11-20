export type CapabilityView = 'knowledge' | 'fast' | 'slow';
/** Compatibility aliases never create separate pages or change research-session history. */
export const canonicalCapabilityView = (_view: CapabilityView): 'knowledge' => 'knowledge';
