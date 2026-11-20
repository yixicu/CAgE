import type { AnyResearchEvent } from '../research/contracts/loop.js';
/** Notifications carry metadata only; fetch the authorized snapshot or exact answer separately. */
export function eventPayload(event: AnyResearchEvent | { type: 'settings.changed' }) {
  if ('contractVersion' in event && event.contractVersion === 'v0-test-1') {
    const { contractVersion, type, projectId, epoch, phase, status, userVisible, message } = event;
    return { contractVersion, type, projectId, epoch, ...(phase ? { phase } : {}), ...(status ? { status } : {}),
      ...(userVisible !== undefined ? { userVisible } : {}), ...(message ? { message } : {}) };
  }
  if ('contractVersion' in event && event.contractVersion === '2.1') {
    const { contractVersion, type, projectId, epoch, phase, taskId, branchId, status, userVisible, message } = event;
    return { contractVersion, type, projectId, epoch, ...(phase ? { phase } : {}), ...(taskId ? { taskId } : {}),
      ...(branchId ? { branchId } : {}), ...(status ? { status } : {}), ...(userVisible !== undefined ? { userVisible } : {}), ...(message ? { message } : {}) };
  }
  return event;
}
