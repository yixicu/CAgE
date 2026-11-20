/** Local layout only: no project data, requests or scientific state. */
export const SIDEBAR_KEY = 'cage.sidebar-widths.v1';
export const bounds = { left: [200, 380], right: [260, 460] } as const;
export function sidebarWidths(width: number, left: number, right: number, leftOpen: boolean, rightOpen: boolean) {
  const clamp = (value: number, side: 'left' | 'right') => Math.max(bounds[side][0], Math.min(bounds[side][1], value));
  left = clamp(left, 'left'); right = clamp(right, 'right');
  const available = Math.max(0, width - 400);
  const excess = Math.max(0, (leftOpen ? left : 0) + (rightOpen ? right : 0) - available);
  const leftRoom = leftOpen ? left - bounds.left[0] : 0;
  const rightRoom = rightOpen ? right - bounds.right[0] : 0;
  const room = leftRoom + rightRoom;
  if (room && excess) { const ratio = Math.min(1, excess / room); left -= leftRoom * ratio; right -= rightRoom * ratio; }
  return { left, right };
}
export function resizeSidebars(node: HTMLElement, state: { left: boolean; right: boolean }) {
  let preferred: { left: number; right: number } | undefined;
  try {
    const stored = JSON.parse(localStorage.getItem(SIDEBAR_KEY) || 'null');
    if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.right)) preferred = sidebarWidths(10000, stored.left, stored.right, true, true);
  } catch { /* Storage is optional. */ }
  let active: { side: 'left' | 'right'; pointer: number; x: number; width: number; handle: HTMLElement } | undefined;
  let current = { left: 244, right: 340 };
  const originalTransition = node.style.transition;
  const originalSelection = node.style.userSelect;
  function finish() {
    const drag = active; active = undefined;
    node.style.transition = originalTransition; node.style.userSelect = originalSelection;
    if (drag?.handle.hasPointerCapture(drag.pointer)) drag.handle.releasePointerCapture(drag.pointer);
    if (preferred) try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(preferred)); } catch { /* Tab-local fallback. */ }
  }
  function measure() {
    const width = node.getBoundingClientRect().width;
    if (window.matchMedia('(max-width:900px)').matches) {
      if (active) finish();
      if (node.style.getPropertyValue('--nav-width')) node.style.removeProperty('--nav-width');
      if (node.style.getPropertyValue('--inspector-width')) node.style.removeProperty('--inspector-width');
      return;
    }
    const defaults = width >= 1700 ? { left: 260, right: 380 } : width <= 1180 ? { left: 220, right: 300 } : { left: 244, right: 340 };
    current = sidebarWidths(width, (preferred || defaults).left, (preferred || defaults).right, state.left, state.right);
    if (node.style.getPropertyValue('--nav-width') !== `${current.left}px`) node.style.setProperty('--nav-width', `${current.left}px`);
    if (node.style.getPropertyValue('--inspector-width') !== `${current.right}px`) node.style.setProperty('--inspector-width', `${current.right}px`);
    for (const side of ['left', 'right'] as const) {
      const handle = node.querySelector<HTMLElement>(`[data-resize-side="${side}"]`);
      if (!handle) continue;
      const opposite = side === 'left' ? 'right' : 'left';
      const max = Math.max(bounds[side][0], Math.min(bounds[side][1], width - 400 - (state[opposite] ? current[opposite] : 0)));
      handle.setAttribute('aria-valuemin', String(bounds[side][0])); handle.setAttribute('aria-valuemax', String(Math.round(max)));
      handle.setAttribute('aria-valuenow', String(Math.round(current[side])));
      handle.setAttribute('aria-valuetext', `${Math.round(current[side])} pixels`);
    }
  }
  function target(event: Event) { return (event.target as HTMLElement).closest<HTMLElement>('[data-resize-side]'); }
  function change(side: 'left' | 'right', value: number) {
    const opposite = side === 'left' ? 'right' : 'left';
    const maximum = Math.min(bounds[side][1], node.getBoundingClientRect().width - 400 - (state[opposite] ? current[opposite] : 0));
    preferred = { ...(preferred || current), [side]: Math.max(bounds[side][0], Math.min(maximum, value)) };
    measure();
  }
  function down(event: PointerEvent) {
    const handle = target(event), side = handle?.dataset.resizeSide as 'left' | 'right' | undefined;
    if (!handle || !side || event.button !== 0 || !event.isPrimary || window.matchMedia('(max-width:900px)').matches) return;
    finish(); event.preventDefault(); handle.focus();
    active = { side, pointer: event.pointerId, x: event.clientX, width: current[side], handle };
    node.style.transition = 'none'; node.style.userSelect = 'none'; handle.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) { if (active && event.pointerId === active.pointer) change(active.side, active.width + (event.clientX - active.x) * (active.side === 'left' ? 1 : -1)); }
  function end(event: PointerEvent) { if (active?.pointer === event.pointerId) finish(); }
  function key(event: KeyboardEvent) {
    const side = target(event)?.dataset.resizeSide as 'left' | 'right' | undefined;
    if (!side || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const delta = (event.shiftKey ? 32 : 8) * (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
    change(side, event.key === 'Home' ? bounds[side][0] : event.key === 'End' ? bounds[side][1] : current[side] + delta); finish();
  }
  node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end); node.addEventListener('lostpointercapture', end); node.addEventListener('keydown', key);
  window.addEventListener('blur', finish);
  const observer = new ResizeObserver(measure); observer.observe(node);
  // Svelte can replace the shell style when theme tokens change. Restore only
  // missing/changed layout properties, without observing descendants or looping.
  const mutations = new MutationObserver(measure); mutations.observe(node, { attributes: true, attributeFilter: ['style'], childList: true });
  measure();
  return { update(next: typeof state) { state = next; if (active && !state[active.side]) finish(); measure(); }, destroy() {
    finish(); observer.disconnect(); mutations.disconnect(); window.removeEventListener('blur', finish);
    node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', end); node.removeEventListener('lostpointercapture', end); node.removeEventListener('keydown', key);
    node.style.removeProperty('--nav-width'); node.style.removeProperty('--inspector-width');
  } };
}
