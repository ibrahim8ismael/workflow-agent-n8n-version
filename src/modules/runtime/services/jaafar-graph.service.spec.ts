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
          modelCalls: [],
        }),
      }),
      graphConfig: vi.fn().mockReturnValue({ configurable: { thread_id: 'understanding-thread' } }),
    };
    const planningService = {
      createPlanResult: vi.fn().mockResolvedValue({
        plan: {
          schemaVersion: 1,
          goal: 'Find the policy',
          steps: [],
          successCriteria: [],
          requiresApproval: false,
        },
        modelCall: { purpose: 'planning' },
      }),
    };

    const service = new JaafarGraphService(
      understandingGraph as never,
      contextLoader as never,
      planningService as never,
    );

    const result = await service.classify({
      runId: 'run-1',
      agentId: 'agent-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'Find the policy',
      mode: RuntimeMode.EXECUTION,
    });

    expect(result.route).toBe('task_execution');
    expect(result.plan?.goal).toBe('Find the policy');
    // Plan_task must plan directly — re-invoking the understanding graph here
    // doubled the LLM chain and could drift the route.
    expect(understandingGraph.build).toHaveBeenCalledTimes(1);
    expect(planningService.createPlanResult).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'Find the policy',
        agentName: 'Jaafar',
        agentInstructions: 'Be concise',
      }),
    );
    expect(understandingGraph.graphConfig).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ userId: 'user-1', organizationId: 'org-1' }),
    );
  });

  it('scopes the top-level checkpoint thread', () => {
    const service = new JaafarGraphService({} as never, {} as never, {} as never);

    expect(service.graphConfig('run-1', { userId: 'user-1', organizationId: 'org-1' })).toEqual({
      configurable: { thread_id: 'jaafar:graph:org-1:user-1:run-1' },
    });
  });
});
