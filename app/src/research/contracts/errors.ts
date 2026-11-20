/** Stable errors shared by implementation bundles and application adapters. */
export class ValidationError extends Error { constructor(label: string) { super(`Invalid ${label}; required schema or scientific evidence is missing.`); this.name = 'ValidationError'; } }
export class ResearchVersionError extends Error {
  readonly code = 'RESEARCH_VERSION_UNSUPPORTED';
  constructor(message = 'This research loop, protocol or data contract is unsupported. Install its compatible implementation; no fallback or migration was performed.') { super(message); this.name = 'ResearchVersionError'; }
}
export class ResearchSelectionError extends Error {
  constructor(readonly code: 'RESEARCH_VERSION_BUSY' | 'RESEARCH_VERSION_CONFLICT' | 'RESEARCH_VERSION_INCOMPATIBLE', message: string) { super(message); this.name = 'ResearchSelectionError'; }
}
