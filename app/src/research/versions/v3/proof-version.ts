/** Public loops that use the V3 scientific proof and learning contracts. */
export function usesV3Proof(version: unknown): version is '3.0' | '4.0' {
  return version === '3.0' || version === '4.0';
}
