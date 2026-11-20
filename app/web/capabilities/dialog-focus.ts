/** Own only dialog keyboard/focus lifecycle. Request generations remain in the page. */
export function containDialogFocus(node: HTMLElement, onclose: () => void) {
  const focusable = () => [...node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')].filter(element => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onclose(); }
    if (event.key !== 'Tab') return;
    const elements = focusable(), first = elements[0], last = elements.at(-1), active = node.ownerDocument.activeElement;
    if (!first) { event.preventDefault(); node.focus(); return; }
    if (event.shiftKey && (active === first || !elements.includes(active as HTMLElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (active === last || !elements.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
  };
  const focusin = (event: FocusEvent) => { if (!node.contains(event.target as Node)) (focusable()[0] ?? node).focus(); };
  node.ownerDocument.addEventListener('keydown', keydown);
  node.ownerDocument.addEventListener('focusin', focusin);
  return { destroy() { node.ownerDocument.removeEventListener('keydown', keydown); node.ownerDocument.removeEventListener('focusin', focusin); } };
}
