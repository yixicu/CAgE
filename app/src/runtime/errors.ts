/** Stable public errors. Never attach provider exceptions, request bodies, keys or causes. */
export type RuntimeErrorCode = 'MODEL_CATALOG_FAILED' | 'MODEL_CATALOG_OFFLINE' | 'MODEL_CATALOG_UNSUPPORTED' | 'SCIENTIFIC_STEP_REJECTED' | 'INSUFFICIENT_PERMISSION' | 'OPERATION_RECONCILIATION_REQUIRED' | 'TOOL_PROTOCOL_FAILED' | 'STRICT_REQUEST_REJECTED' | 'STRICT_OUTPUT_UNSUPPORTED' | 'STRICT_SCHEMA_UNSUPPORTED' | 'MODEL_REQUIRED' | 'MODEL_UNAVAILABLE' | 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'AUTH_UNSUPPORTED' | 'AUTH_CANCELLED' | 'AUTH_INPUT_REQUIRED' | 'INVALID_CONFIGURATION' | 'INVALID_TOOL' | 'INVALID_OUTPUT' | 'SESSION_NOT_FOUND' | 'SESSION_BUSY' | 'PROVIDER_FAILED' | 'BUDGET_EXHAUSTED' | 'BUDGET_UNAVAILABLE' | 'CONTEXT_EXHAUSTED' | 'TOOL_FAILED';
const messages: Record<RuntimeErrorCode, string> = {
  OPERATION_RECONCILIATION_REQUIRED: 'A prior save may have taken effect without a durable receipt. Saved work is preserved; reconcile this operation before retrying it.',
  TOOL_PROTOCOL_FAILED: 'The model returned an incomplete or unsupported tool-call batch. Saved work remains available; no scientific conclusion was assigned.',
  STRICT_REQUEST_REJECTED: 'The provider rejected the strict research request. Automatic execution stopped without a JSON-mode fallback; check this model and endpoint capability or schema support.',
  STRICT_OUTPUT_UNSUPPORTED: 'This provider or endpoint does not support the required strict research contract. Automatic execution was blocked; no JSON-mode fallback is allowed.',
  STRICT_SCHEMA_UNSUPPORTED: 'The selected strict provider cannot represent this task or tool schema. Automatic execution was blocked before dispatch.',
  MODEL_REQUIRED: 'Choose a provider and model before starting research.',
  MODEL_CATALOG_UNSUPPORTED: 'This provider does not offer a refreshable model catalog.',
  MODEL_CATALOG_OFFLINE: 'Model catalog refresh is disabled by PI_OFFLINE.',
  MODEL_CATALOG_FAILED: 'Could not refresh the model catalog. Your saved model selection is unchanged. Try again when connected.',
  MODEL_UNAVAILABLE: 'The selected model is unavailable. Choose an available model explicitly.',
  AUTH_REQUIRED: 'Connect the selected provider in settings before starting research.',
  AUTH_FAILED: 'Provider sign-in or credential storage failed. Check provider settings and try again.',
  AUTH_UNSUPPORTED: 'This sign-in method is not supported by the selected provider.',
  AUTH_CANCELLED: 'Provider sign-in was cancelled.',
  AUTH_INPUT_REQUIRED: 'This provider needs additional sign-in fields. Use the guided connection flow.',
  INVALID_CONFIGURATION: 'The runtime configuration is invalid.',
  INSUFFICIENT_PERMISSION: 'Insufficient permission. Open Maintenance Assistant to request this change.',
  INVALID_TOOL: 'The role requested a tool that is not allowed.',
  SCIENTIFIC_STEP_REJECTED: 'The scientific declaration was rejected. The saved original remains available. A fresh scientific step is required.',
  INVALID_OUTPUT: 'The model did not return a valid structured result.',
  SESSION_NOT_FOUND: 'The research session is no longer available.',
  SESSION_BUSY: 'The research session already has an active task.',
  PROVIDER_FAILED: 'The selected provider request failed. No scientific conclusion was assigned.',
  BUDGET_UNAVAILABLE: 'The provider does not report the usage needed to enforce this budget. Choose another model or remove the unsupported cap.',
  BUDGET_EXHAUSTED: 'The research session reached its established budget or deadline.',
  CONTEXT_EXHAUSTED: 'The selected model cannot fit the required research context. Saved premises and paths were preserved; choose a larger context model.',
  TOOL_FAILED: 'A restricted tool was denied or failed. No scientific conclusion was assigned.',
};
export class RuntimeError extends Error {
  readonly executionStatus: 'interrupted' | 'failed';
  constructor(readonly code: RuntimeErrorCode) {
    super(messages[code]);
    this.name = 'RuntimeError';
    this.executionStatus = code === 'BUDGET_EXHAUSTED' || code === 'BUDGET_UNAVAILABLE' || code === 'CONTEXT_EXHAUSTED' || code === 'AUTH_CANCELLED' ? 'interrupted' : 'failed';
  }
}
export const maintenanceReferral = 'A system operation was skipped. You can request it in Maintenance Assistant.';
export const maintenanceSkipInstruction = 'This system operation is unavailable here. Skip it and continue the scientific task with your available tools. The user will receive a Maintenance Assistant notice.';
const nodeOperations = new Set(['maintenance_list_nodes','maintenance_read_node','maintenance_create_node','maintenance_edit_node','maintenance_delete_node']);
export function isSystemMaintenanceTool(name:string):boolean {
  return name==='maintenance_read_rounds'||name==='maintenance_review_import';
}
export function scienceToolDenial(name:string):string|undefined {
  if (isSystemMaintenanceTool(name)) return maintenanceSkipInstruction;
  if (nodeOperations.has(name)) return 'Use your available scientific knowledge lookup, proposal, revision or review tools for this operation within their grants. If this change is unavailable, skip it and continue the scientific task.';
  if(name.startsWith('maintenance_')) return 'This operation is unavailable. Skip it and continue with the scientific tools provided for this task.';
}
export function maintenanceToolRequested(message: {content: ReadonlyArray<{type:string; name?:string}>}): boolean {
  return message.content.some(part => part.type === 'toolCall' && part.name?.startsWith('maintenance_'));
}
export function publicRuntimeError(error: unknown): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError('PROVIDER_FAILED');
}
