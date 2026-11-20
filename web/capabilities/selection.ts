import type { CapabilityItem } from '../../src/server/capabilities-types';
/** Refresh may update the same exact selection, never promote it by ID alone. */
export function reconcileSelection(selected: CapabilityItem, items: CapabilityItem[]) {
  const current = items.find(item => item.key === selected.key && item.id === selected.id && item.version === selected.version);
  return { item: current ?? selected, stale: !current?.available };
}
