import { requestGate } from './requests.ts';
/** Loads and post-selection refreshes share one ordering; old reads never replace newer writes. */
export function networkRequests<T>() {
  const gate = requestGate();
  return {
    cancel: gate.cancel,
    async run(read: () => Promise<T>, apply: (value: T) => void | Promise<void>) {
      const current = gate.begin();
      try { const value = await read(); if (current()) await apply(value); }
      catch (error) { if (current()) throw error; }
      return current();
    },
  };
}
