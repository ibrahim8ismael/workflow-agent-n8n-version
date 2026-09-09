import { Injectable } from '@nestjs/common';

export type AutomationErrorCode =
  | 'CREDENTIAL_ERROR'
  | 'PERMISSION_ERROR'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_EXPRESSION'
  | 'MISSING_DATA'
  | 'API_ERROR'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'LOGIC_ERROR'
  | 'UNKNOWN';

export type RepairStrategy =
  | 'fix_credentials'
  | 'replan_step'
  | 'patch_expression'
  | 'adjust_config'
  | 'retry_execution'
  | 'escalate';

export interface ClassifiedAutomationError {
  code: AutomationErrorCode;
  /** Safe to retry the same operation without changes. */
  retryable: boolean;
  /** Which repair strategy the self-repair engine should try first. */
  repairStrategy: RepairStrategy;
  /** Operator-readable one-liner (no secrets, no raw stack traces). */
  summary: string;
  /** Concrete action for the user when only they can unblock it. */
  userAction?: string;
}

/**
 * Error Classification (docs/Jaafar-improve.md §25).
 *
 * Maps raw provision/test/validation failures to a stable code + the repair
 * strategy the self-repair engine tries first. Credential-shaped failures
 * always surface a clear user action (§26) — Jaafar never asks the user to
 * "check the logs".
 */
@Injectable()
export class AutomationErrorClassifierService {
  classify(error: unknown, stage = 'unknown'): ClassifiedAutomationError {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const statusCode =
      typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : undefined;
    const providerCode =
      typeof (error as { code?: unknown })?.code === 'string'
        ? ((error as { code: string }).code as string)
        : '';

    if (
      providerCode === 'INVALID_CREDENTIALS' ||
      statusCode === 401 ||
      statusCode === 403 ||
      /(invalid credentials|api key rejected|unauthorized|authentication failed|credential.*(invalid|expired|missing|rejected)|no .*active .*connection|connection.*(inactive|missing|not active|unavailable)|not bound to)/.test(
        normalized,
      )
    ) {
      return {
        code: 'CREDENTIAL_ERROR',
        retryable: false,
        repairStrategy: 'fix_credentials',
        summary: `Authentication with n8n failed during ${stage}.`,
        userAction:
          'Reconnect the n8n instance (or the failing integration credential inside n8n) and retry — nothing needs rebuilding.',
      };
    }
    if (
      /(forbidden|permission|access denied|not allowed|insufficient.*(scope|permission))/.test(
        normalized,
      )
    ) {
      return {
        code: 'PERMISSION_ERROR',
        retryable: false,
        repairStrategy: 'escalate',
        summary: `n8n refused the call during ${stage}: permission denied.`,
        userAction:
          'Grant the n8n API key (or the integration credential) the missing permission, then retry.',
      };
    }
    if (statusCode === 429 || /rate limit|too many requests|429/.test(normalized)) {
      return {
        code: 'RATE_LIMIT',
        retryable: true,
        repairStrategy: 'retry_execution',
        summary: `n8n rate-limited the call during ${stage}.`,
      };
    }
    if (
      /timed out|timeout|timedout|abort|deadline exceeded/.test(normalized) ||
      /timed out after \d+ms/.test(message)
    ) {
      return {
        code: 'TIMEOUT',
        retryable: true,
        repairStrategy: 'retry_execution',
        summary: `The call timed out during ${stage}.`,
      };
    }
    if (
      statusCode === 404 ||
      /not found|no such|unknown node|missing.*(table|workflow|credential)/.test(normalized)
    ) {
      return {
        code: 'MISSING_DATA',
        retryable: false,
        repairStrategy: 'adjust_config',
        summary: `Something the automation references is missing during ${stage}.`,
      };
    }
    if (
      /unbalanced|expression|invalid.*(syntax|json|parameter)|unexpected token|forward reference|unknown node|hallucinated/.test(
        normalized,
      )
    ) {
      return {
        code: 'INVALID_EXPRESSION',
        retryable: false,
        repairStrategy: 'patch_expression',
        summary: `The workflow contains an invalid expression or node reference (${stage}).`,
      };
    }
    if (
      /validation failed|failed static validation|failed review|invalid plan|uncovered requirement|schema|zod/.test(
        normalized,
      )
    ) {
      return {
        code: 'INVALID_CONFIGURATION',
        retryable: false,
        repairStrategy: 'replan_step',
        summary: `The automation plan itself is invalid (${stage}).`,
      };
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return {
        code: 'LOGIC_ERROR',
        retryable: false,
        repairStrategy: 'replan_step',
        summary: `n8n rejected the request during ${stage} (HTTP ${statusCode}).`,
      };
    }
    if (
      (statusCode !== undefined && statusCode >= 500) ||
      /unreachable|network|econn|socket|bad gateway|service unavailable|html error|fetch failed/.test(
        normalized,
      )
    ) {
      return {
        code: 'API_ERROR',
        retryable: true,
        repairStrategy: 'retry_execution',
        summary: `The n8n instance errored during ${stage}${statusCode ? ` (HTTP ${statusCode})` : ''}.`,
      };
    }
    return {
      code: 'UNKNOWN',
      retryable: false,
      repairStrategy: 'escalate',
      summary: `The automation failed during ${stage} for an unrecognized reason.`,
    };
  }
}
