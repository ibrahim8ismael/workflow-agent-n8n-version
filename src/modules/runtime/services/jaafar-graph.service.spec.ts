import { describe, expect, it, vi } from 'vitest';
import { RuntimeMode } from '../types/runtime.types';
import { JaafarGraphService } from './jaafar-graph.service';

describe('JaafarGraphService', () => {
  it('routes a request through the top-level understanding boundary', async () => {
    const contextLoader = {
      load: vi.fn().mockResolvedValue({
        agent: { id: 'agent-1', name: 'Jaafar', instructions: 'Be concise' },
        history: [],
        tools: [],
        memoryReferences: [],
        knowledgeReferences: [],
        readiness: [],
      }),
    };
    const understandingGraph = {
      build: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          understanding: {
            route: 'task_execution',
            intent: 'task_execution',
            goal: 'Find the policy',
            businessContext: '',
            requirements: [],
            missingInputs: [],
            confidence: 0.95,
            clarificationRequired: false,
          },
          context: { tools: [], memoryReferences: [], knowledgeReferences: [], readiness: [] },
          plan: {
            schemaVersion: 1,
            goal: 'Find the policy',
            steps: [],
            successCriteria: [],
            requiresApproval: false,
          },
          modelCalls: [],
        }),
      }),
      graphConfig: vi.fn().mockReturnValue({ configurable: { thread_id: 'understanding-thread' } }),
    };

    const service = new JaafarGraphService(understandingGraph as never, contextLoader as never);

    const result = await service.classify({
      runId: 'run-1',
      agentId: 'agent-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'Find the policy',
      mode: RuntimeMode.EXECUTION,
    });

    expect(result.route).toBe('task_execution');
    expect(understandingGraph.build).toHaveBeenCalledWith({ durable: true });
    expect(understandingGraph.graphConfig).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ userId: 'user-1', organizationId: 'org-1' }),
    );
  });

  it('scopes the top-level checkpoint thread', () => {
    const service = new JaafarGraphService({} as never, {} as never);

    expect(service.graphConfig('run-1', { userId: 'user-1', organizationId: 'org-1' })).toEqual({
      configurable: { thread_id: 'jaafar:graph:org-1:user-1:run-1' },
    });
  });
});
