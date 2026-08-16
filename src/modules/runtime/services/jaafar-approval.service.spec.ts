import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../interfaces/tool.interface';
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
  JaafarApprovalService,
} from './jaafar-approval.service';

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'tool-1',
  name: 'Knowledge search',
  slug: 'knowledge-search',
  description: 'Search knowledge',
  executionMode: 'knowledge',
  inputSchema: {},
  outputSchema: {},
  requiredPermissions: [],
  requiredIntegrations: [],
  requiresApproval: false,
  timeoutMs: 10_000,
  maxRetries: 1,
  retryPolicy: { maxAttempts: 1, retryableCodes: [] },
  idempotent: true,
  successCriteria: [],
  permissionScope: 'employee',
  ...overrides,
});

const service = (values: Record<string, unknown> = {}) =>
  new JaafarApprovalService({
    get: vi.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService);

describe('JaafarApprovalService', () => {
  it('allows explicitly read-only knowledge tools without approval', () => {
    const evaluation = service().evaluate(tool(), { query: 'policies' });

    expect(evaluation.readOnly).toBe(true);
    expect(evaluation.requirement).toEqual({ required: false });
    expect(() => service().assertExecutionAllowed(evaluation, 'not_required')).not.toThrow();
  });

  it('requires approval for side-effecting tools before execution', () => {
    const evaluation = service().evaluate(
      tool({
        name: 'Send email',
        slug: 'send-email',
        executionMode: 'n8n',
        sideEffect: true,
      }),
      { recipient: 'person@example.com' },
    );

    expect(evaluation.requirement.required).toBe(true);
    expect(() => service().assertExecutionAllowed(evaluation, 'pending')).toThrow(
      ApprovalRequiredError,
    );
    expect(() => service().assertExecutionAllowed(evaluation, 'approved')).not.toThrow();
  });

  it('requires approval for configured tools and risky arguments', () => {
    const configured = service({ JAAFAR_APPROVAL_REQUIRED_TOOLS: 'tool-1' });
    expect(configured.evaluate(tool(), {}).requirement.required).toBe(true);

    const risky = service().evaluate(tool({ executionMode: 'ai', name: 'Account action' }), {
      delete: true,
    });
    expect(risky.readOnly).toBe(false);
    expect(risky.requirement.reason).toContain('arguments');
  });

  it('cannot execute a rejected approval', () => {
    const evaluation = service().evaluate(tool({ requiresApproval: true }), {});

    expect(() => service().assertExecutionAllowed(evaluation, 'rejected')).toThrow(
      ApprovalRejectedError,
    );
  });

  it('does not treat a false risky argument as a side effect request', () => {
    const evaluation = service().evaluate(tool({ executionMode: 'ai' }), { delete: false });

    expect(evaluation.requirement.required).toBe(false);
  });
});
