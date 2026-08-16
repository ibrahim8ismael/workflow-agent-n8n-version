export function runtimeUserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('approval')) {
    return 'This action is waiting for your approval before it can continue.';
  }
  if (normalized.includes('permission') || normalized.includes('forbidden')) {
    return 'You do not have permission to complete this action in the current workspace.';
  }
  if (normalized.includes('not found')) {
    return 'The requested business record could not be found.';
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return 'The action took too long to complete. No successful result was confirmed.';
  }
  if (normalized.includes('missing') || normalized.includes('not configured')) {
    return 'A required capability or connection is not configured yet.';
  }
  if (normalized.includes('invalid') || normalized.includes('validation')) {
    return 'The request could not be completed because some information is invalid or incomplete.';
  }

  return 'I could not complete this action. No successful result was confirmed.';
}
