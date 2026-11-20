/** Presentation-only Svelte action. Match the composer's two edges to the
 * actual paper border box, including classic scrollbar and responsive gutters.
 * Paper and input retain their own intentional inner padding; never collapse
 * the reading surface to its prose box just to match the input chrome.
 * The dock remains overflow-visible so existing model menus are never clipped. */
export function alignReadingColumn(node: HTMLElement, source?: HTMLElement) {
  const outer = node.parentElement;
  const properties = ['width', 'max-width', 'margin-left', 'margin-right', 'box-sizing'] as const;
  const original = properties.map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)] as const);
  let frame = 0;
  let disposed = false;
  let previous = '';
  const restore = () => {
    for (const [name, value, priority] of original) {
      if (value) node.style.setProperty(name, value, priority);
      else node.style.removeProperty(name);
    }
    previous = '';
  };
  const pixels = (value: string) => Number.parseFloat(value) || 0;
  const measure = () => {
    frame = 0;
    if (disposed) return;
    if (!outer || !source?.isConnected || !source.getClientRects().length) { restore(); return; }
    const box = source.getBoundingClientRect();
    const parent = outer.getBoundingClientRect();
    const parentStyle = getComputedStyle(outer);
    const width = Math.max(0, box.width);
    const left = box.left - parent.left - pixels(parentStyle.borderLeftWidth) - pixels(parentStyle.paddingLeft);
    const next = `${width.toFixed(3)}:${left.toFixed(3)}`;
    if (!width) { restore(); return; }
    if (next === previous) return;
    previous = next;
    node.style.setProperty('box-sizing', 'border-box');
    node.style.setProperty('width', `${width}px`);
    node.style.setProperty('max-width', 'none');
    node.style.setProperty('margin-left', `${left}px`);
    node.style.setProperty('margin-right', '0px');
  };
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
  // Never observe the target whose dimensions this action writes.
  const observer = new ResizeObserver(schedule);
  const observe = () => {
    observer.disconnect();
    if (outer) observer.observe(outer);
    if (source) observer.observe(source);
    schedule();
  };
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  observe();
  return {
    update(next?: HTMLElement) { source = next; observe(); },
    destroy() {
      disposed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      restore();
    },
  };
}
