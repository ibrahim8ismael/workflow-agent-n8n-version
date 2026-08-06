export type SkillRuntimeErrorCode =
  | 'SKILL_NOT_FOUND'
  | 'SKILL_NOT_ACTIVE'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'APPROVAL_REQUIRED'
  | 'DEPENDENCY_MISSING'
  | 'PERMISSION_DENIED'
  | 'EXECUTION_TIMEOUT'
  | 'EXECUTION_FAILED';

export class SkillRuntimeError extends Error {
  constructor(
    public readonly code: SkillRuntimeErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'SkillRuntimeError';
  }
}
