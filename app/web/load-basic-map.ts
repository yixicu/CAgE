export async function loadBasicMap() {
  return (await import('./core-preview.json')).default;
}
