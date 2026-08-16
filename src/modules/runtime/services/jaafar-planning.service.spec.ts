import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../interfaces/tool.interface';
import type { JaafarPlan } from '../types/jaafar-plan.types';
import type { JaafarUnderstanding } from '../types/jaafar-understanding.types';
import { JaafarPlanningService } from './jaafar-planning.service';

const understanding: JaafarUnderstanding = {
  intent: 'task_execution',
  goal: 'Send the report',
  businessContext: 'Operations',
  requirements: [],
  missingInputs: [],
  confidence: 0.95,
  clarificationRequired: false,
};

const tool: ToolDefinition = {
  id: 'send_report',
  name: 'send_report',
  slug: 'send_report',
  description: 'Send a report to a recipient',
  executionMode: 'n8n',
  inputSchema: {
    type: 'object',
    properties: { recipient: { type: 'string' } },
    required: ['recipient'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object' },
  requiredPermissions: [],
  requiredIntegrations: [],
  requiresApproval: false,
  sideEffect: true,
  timeoutMs: 30_000,
  maxRetries: 0,
  retryPolicy: { maxAttempts: 1, retryableCodes: [] },
  idempotent: true,
  successCriteria: ['Report was accepted by the recipient system'],
  permissionScope: 'organization',
};

const validPlan: JaafarPlan = {
  schemaVersion: 1,
  goal: 'Send the report',
  steps: [
    {
      stepId: 'step-1',
      toolId: 'send_report',
      order: 0,
      input: { recipient: 'ops@example.com' },
      required: true,
    },
  ],
  successCriteria: ['Report was sent'],
  requiresApproval: true,
};

describe('JaafarPlanningService', () => {
  it('creates a validated runtime plan through the model gateway', async () => {
    const llmRuntime = { generateObject: vi.fn().mockResolvedValue({ object: validPlan }) };
    const service = new JaafarPlanningService(llmRuntime as never);

    await expect(
      service.createPlan({ understanding, tools: [tool], userMessage: 'Send the report' }),
    ).resolves.toMatchObject({
      ...validPlan,
      approvalReasons: ['send_report requires approval before execution'],
    });
    expect(llmRuntime.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ schema: expect.anything(), mode: 'medium' }),
    );
  });

  it('rejects unavailable tools and invalid required inputs', () => {
    const service = new JaafarPlanningService({} as never);
    const result = service.validatePlan(
      {
        ...validPlan,
        requiresApproval: false,
        steps: [
          { ...validPlan.steps[0], toolId: 'missing_tool' },
          { stepId: 'step-2', toolId: 'send_report', order: 1, input: {}, required: true },
        ],
      },
      [tool],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['TOOL_NOT_FOUND', 'INVALID_TOOL_INPUT', 'APPROVAL_REQUIRED']),
    );
  });

  it('rejects invalid dependencies and cycles', () => {
    const service = new JaafarPlanningService({} as never);
    const result = service.validatePlan(
      {
        ...validPlan,
        steps: [
          {
            stepId: 'step-1',
            toolId: 'send_report',
            order: 0,
            input: { recipient: 'a' },
            required: true,
            dependsOn: ['step-2'],
          },
          {
            stepId: 'step-2',
            toolId: 'send_report',
            order: 1,
            input: { recipient: 'b' },
            required: true,
            dependsOn: ['step-1'],
          },
        ],
      },
      [{ ...tool, sideEffect: false }],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes('cycle'))).toBe(true);
  });

  it('does not call the model when understanding still requires input', async () => {
    const llmRuntime = { generateObject: vi.fn() };
    const service = new JaafarPlanningService(llmRuntime as never);

    await expect(
      service.createPlan({
        understanding: {
          ...understanding,
          missingInputs: [
            { field: 'recipient', description: 'Recipient', question: 'Who?', required: true },
          ],
        },
        tools: [tool],
        userMessage: 'Send it',
      }),
    ).rejects.toThrow('required inputs are missing');
    expect(llmRuntime.generateObject).not.toHaveBeenCalled();
  });
});
