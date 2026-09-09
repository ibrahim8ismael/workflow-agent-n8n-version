import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationBlueprint } from '../../automations/schemas/automation-blueprint.schema';
import type { ClassifiedAutomationError } from './automation-error-classifier.service';
import { AutomationRepairService, MAX_REPAIR_ATTEMPTS } from './automation-repair.service';

const blueprint = (overrides: Partial<AutomationBlueprint> = {}): AutomationBlueprint => ({
  ready: true,
  missingRequirements: [],
  name: 'Order sync',
  goal: 'Sync orders',
  summary: 'Syncs',
  description: '',
  trigger: { type: 'webhook', config: {} },
  steps: [
    {
      id: 'S1',
      name: 'Receive order',
      action: 'Receive the order',
      config: {},
      requirementIds: ['R1'],
      nodeHint: { type: 'n8n-nodes-base.webhook', parameters: {} },
    },
  ],
  integrations: [],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
  ...overrides,
});

const classified = (
  overrides: Partial<ClassifiedAutomationError> = {},
): ClassifiedAutomationError => ({
  code: 'INVALID_EXPRESSION',
  retryable: false,
  repairStrategy: 'patch_expression',
  summary: 'Bad expression.',
  ...overrides,
});

describe('AutomationRepairService', () => {
  const llmRuntime = { generateObject: vi.fn() };
  const service = () => new AutomationRepairService(llmRuntime as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const input = (overrides = {}) => ({
    blueprint: blueprint(),
    failure: {
      stage: 'test' as const,
      message: 'Step "Log" has unbalanced expression delimiters',
      classified: classified(),
    },
    requirements: [{ id: 'R1', field: 'sync', required: true }],
    conditions: [],
    attempt: 1,
    ...overrides,
  });

  it('diagnoses and returns a corrected blueprint', async () => {
    const patched = blueprint({ name: 'Order sync (fixed)' });
    llmRuntime.generateObject.mockResolvedValue({
      object: {
        diagnosis: 'The Code node used an unclosed {{ delimiter.',
        changes: ['Closed the expression in the Log step'],
        blueprint: {
          ...patched,
          steps: patched.steps.map((s) => ({ ...s, config: s.config ?? {} })),
        },
      },
    });

    const outcome = await service().diagnoseAndPatch(input());

    expect(outcome.diagnosis).toContain('unclosed');
    expect(outcome.changes).toEqual(['Closed the expression in the Log step']);
    expect(outcome.blueprint.name).toBe('Order sync (fixed)');
    expect(outcome.retryUnchanged).toBe(false);
    expect(llmRuntime.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.2 }),
    );
  });

  it('retries unchanged for transient failures without calling the model', async () => {
    const args = input({
      failure: {
        stage: 'test' as const,
        message: 'HTTP 502',
        classified: classified({
          code: 'API_ERROR',
          retryable: true,
          repairStrategy: 'retry_execution',
          summary: 'Instance errored.',
        }),
      },
    });
    const outcome = await service().diagnoseAndPatch(args);

    expect(outcome.retryUnchanged).toBe(true);
    expect(outcome.blueprint).toBe(args.blueprint);
    expect(llmRuntime.generateObject).not.toHaveBeenCalled();
  });

  it('rejects attempts outside the repair budget', async () => {
    await expect(service().diagnoseAndPatch(input({ attempt: 0 }))).rejects.toThrow(
      'outside the 1–3 budget',
    );
    await expect(
      service().diagnoseAndPatch(input({ attempt: MAX_REPAIR_ATTEMPTS + 1 })),
    ).rejects.toThrow('outside the 1–3 budget');
  });

  it('builds the §42 escalation message with succeeded/failed/blocker/action', () => {
    const message = service().escalationMessage({
      automationName: 'Order sync',
      succeeded: ['Plan reviewed', 'Workflow validated', 'Provisioned as v1'],
      failure: {
        stage: 'test',
        message: 'Zoho credential rejected (401)',
        classified: classified({
          code: 'CREDENTIAL_ERROR',
          repairStrategy: 'fix_credentials',
          summary: 'Authentication failed.',
          userAction: 'Reconnect Zoho in n8n and retry.',
        }),
      },
      attempts: [
        {
          attempt: 1,
          at: new Date().toISOString(),
          stage: 'test',
          code: 'CREDENTIAL_ERROR',
          diagnosis: 'Bad credential',
          changes: [],
          blueprintRevision: 'rev-1',
        },
      ],
    });

    expect(message).toContain('I couldn\'t finish the automation "Order sync".');
    expect(message).toContain('What works:');
    expect(message).toContain('What failed:');
    expect(message).toContain('Blocker: Zoho credential rejected (401)');
    expect(message).toContain('Repair attempts: 1/3');
    expect(message).toContain('Reconnect Zoho in n8n and retry.');
  });
});
