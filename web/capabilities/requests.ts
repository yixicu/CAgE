/** A dismissed or superseded request may settle, but cannot restore its view. */
export function requestGate() {
  let generation = 0;
  return { begin() { const mine = ++generation; return () => mine === generation; }, cancel() { generation++; } };
}
