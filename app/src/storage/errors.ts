/** Inspect bounded error causes without guessing from human-facing messages. */
export function hasErrorCode(error: unknown, codes: readonly string[]): boolean {
  const seen = new Set<unknown>();
  for (let depth = 0; error && typeof error === 'object' && depth < 8 && !seen.has(error); depth++) {
    seen.add(error);
    const item = error as { code?: string; cause?: unknown };
    if (item.code && codes.includes(item.code)) return true;
    error = item.cause;
  }
  return false;
}
/** Access/resource failures are not evidence that committed history is corrupt. */
export function isStorageAccessError(error: unknown): boolean {
  return hasErrorCode(error, ['EACCES', 'EPERM', 'EIO', 'ENOMEM', 'ENOSPC', 'EDQUOT', 'EMFILE', 'ENFILE', 'EROFS', 'EBUSY', 'ESTALE', 'EAGAIN', 'EINTR', 'ETIMEDOUT']);
}
