import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationErrorClassifierService } from '../services/automation-error-classifier.service';
import { AutomationPlanReviewService } from '../services/automation-plan-review.service';
import { AutomationWorkflowBuilderService } from '../services/automation-workflow-builder.service';
import { evalDatasetSchema } from './eval-dataset.schema';
import { JaafarEvalService } from './jaafar-eval.service';
import datasetJson from './jaafar-eval-dataset.json';

describe('Jaafar evaluation dataset', () => {
  it('conforms to the schema with 59 unique scenarios', () => {
    const dataset = evalDatasetSchema.parse(datasetJson);

    expect(dataset.version).toBe(2);
    expect(dataset.scenarios).toHaveLength(59);
    const ids = dataset.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every required category', () => {
    const dataset = evalDatasetSchema.parse(datasetJson);
    const categories = new Set(dataset.scenarios.map((s) => s.category));

    for (const category of [
      'basic',
      'mapping',
      'logic',
      'integrations',
      'failure',
      'reliability',
      'ambiguous',
      'complex',
    ] as const) {
      expect(categories.has(category)).toBe(true);
    }
  });
});

describe('JaafarEvalService (offline gate)', () => {
  const connections = { resolveActiveForScope: vi.fn() };
  const nodeInventory = { describeNodeType: vi.fn() };

  const service = () =>
    new JaafarEvalService(
      new AutomationErrorClassifierService(),
      new AutomationPlanReviewService(),
      new AutomationWorkflowBuilderService(
        new AutomationPlanReviewService(),
        {} as never,
        {} as never,
        connections as never,
        nodeInventory as never,
      ),
    );

  beforeEach(() => {
    vi.resetAllMocks();
    // Offline instance view: every documented type resolves; only the
    // intentionally hallucinated type is rejected.
    connections.resolveActiveForScope.mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'https://n8n.example.com',
      apiKey: 'sk',
    });
    nodeInventory.describeNodeType.mockImplementation(async (_conn: unknown, type: string) => {
      if (type === 'n8n-nodes-base.hallucinated') {
        const { N8nNodeSchemaError } = await import(
          '../../../infrastructure/n8n/n8n-node-inventory.service'
        );
        throw new N8nNodeSchemaError('Unknown n8n node type', 'NODE_NOT_FOUND', {});
      }
      return { nodeType: type, operationVerified: true, source: 'harvested', inUse: true };
    });
  });

  it('passes the full offline suite with zero failures', async () => {
    const report = await service().runOffline();

    expect(report.total).toBe(59);
    expect(report.failures).toEqual([]);
    expect(report.failed).toBe(0);
    expect(report.passed + report.skipped).toBe(59);
    expect(report.skipped).toBe(3);
  });

  it('reports per-category breakdowns', async () => {
    const report = await service().runOffline();

    expect(report.byCategory.failure).toMatchObject({ passed: 10, failed: 0, skipped: 0 });
    expect(report.byCategory.complex).toMatchObject({ passed: 7, failed: 0, skipped: 3 });
    expect(report.byCategory.ambiguous).toMatchObject({ passed: 5, failed: 0, skipped: 0 });
  });
});
