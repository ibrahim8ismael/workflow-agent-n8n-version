import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nWorkflowError } from '../../../infrastructure/n8n/n8n-workflow-executor.service';
import type { AutomationBlueprint } from '../../automations/schemas/automation-blueprint.schema';
import { AutomationErrorClassifierService } from './automation-error-classifier.service';
import { AutomationRuntimeValidatorService } from './automation-runtime-validator.service';

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

describe('AutomationRuntimeValidatorService', () => {
  const executor = { execute: vi.fn() };

  const service = () =>
    new AutomationRuntimeValidatorService(
      executor as never,
      new AutomationErrorClassifierService(),
    );

  const input = (overrides = {}) => ({
    blueprint: blueprint(),
    baseUrl: 'https://n8n.example.com',
    webhookPath: 'orders-auto',
    runId: 'run-1',
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes when the workflow responds with the contracted output', async () => {
    executor.execute.mockResolvedValue({ success: true, orderId: 'o-1' });

    const result = await service().validate(
      input({
        blueprint: blueprint({
          inputContract: { properties: { orderId: { type: 'string' } } },
          outputContract: { properties: { orderId: { type: 'string' } } },
        }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.checks).toMatchObject([
      { name: 'workflow_responded', passed: true },
      { name: 'no_error_flag', passed: true },
      { name: 'output_contract', passed: true },
    ]);
    // Test input derived from the contract + validation marker.
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ orderId: 'validation-sample', test: true }),
      }),
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('fails LOGIC_ERROR when the output misses contract keys', async () => {
    executor.execute.mockResolvedValue({ success: true, other: 1 });

    const result = await service().validate(
      input({
        blueprint: blueprint({ outputContract: { properties: { orderId: { type: 'string' } } } }),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: 'output_contract', passed: false }),
    );
    expect(result.classified).toMatchObject({ code: 'LOGIC_ERROR' });
  });

  it('fails when the workflow reports success=false', async () => {
    executor.execute.mockResolvedValue({ success: false, error: 'Zoho rejected the contact' });

    const result = await service().validate(input());

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: 'no_error_flag', passed: false }),
    );
  });

  it('classifies executor failures instead of throwing', async () => {
    executor.execute.mockRejectedValue(
      new N8nWorkflowError('n8n workflow returned HTTP 502', true, 502),
    );

    const result = await service().validate(input());

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: 'workflow_responded', passed: false }),
    );
    expect(result.classified).toMatchObject({ code: 'API_ERROR', retryable: true });
    expect(result.output).toBeUndefined();
  });

  it('skips the contract check when no contract is declared', async () => {
    executor.execute.mockResolvedValue({ anything: 'goes' });

    const result = await service().validate(input());

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: 'output_contract', passed: true }),
    );
  });
});
