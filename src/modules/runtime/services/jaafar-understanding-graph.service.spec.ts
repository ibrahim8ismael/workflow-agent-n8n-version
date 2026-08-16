import { describe, expect, it, vi } from 'vitest';
import { JaafarUnderstandingGraphService } from './jaafar-understanding-graph.service';

describe('JaafarUnderstandingGraphService', () => {
  it('loads scoped context and routes clarification without entering execution', async () => {
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
    const understandingService = {
      understand: vi.fn().mockResolvedValue({
        intent: 'task_execution',
        goal: 'Send the report',
        businessContext: '',
        requirements: [],
        missingInputs: [
          {
            field: 'recipient',
            description: 'Report recipient',
            question: 'Who should receive the report?',
            required: true,
          },
        ],
        confidence: 0.9,
        clarificationRequired: true,
        clarificationQuestion: 'Who should receive the report?',
        route: 'clarification',
      }),
    };
    const planningService = {
      createPlan: vi.fn(),
    };
    const runsService = {
      savePlan: vi.fn(),
    };
    const service = new JaafarUnderstandingGraphService(
      contextLoader as never,
      understandingService as never,
      planningService as never,
      runsService as never,
    );

    const result = await service.build().invoke({
      input: {
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        userMessage: 'Send the report',
      },
    });

    expect(result.understanding?.route).toBe('clarification');
    expect(contextLoader.load).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', userId: 'user-1', organizationId: 'org-1' }),
    );
    expect(understandingService.understand).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'Send the report', history: [] }),
    );
  });

  it('routes a complete task request to planning and persists the plan summary', async () => {
    const tools = [{ id: 'lookup', name: 'lookup', slug: 'lookup' }];
    const contextLoader = {
      load: vi.fn().mockResolvedValue({
        agent: { id: 'agent-1', name: 'Jaafar' },
        history: [],
        tools,
        memoryReferences: [],
        knowledgeReferences: [],
        readiness: [],
      }),
    };
    const understandingService = {
      understand: vi.fn().mockResolvedValue({
        intent: 'task_execution',
        goal: 'Look up the account',
        businessContext: '',
        requirements: [],
        missingInputs: [],
        confidence: 0.95,
        clarificationRequired: false,
        route: 'task_execution',
      }),
    };
    const plan = {
      schemaVersion: 1,
      goal: 'Look up the account',
      steps: [],
      successCriteria: ['Account was found'],
      requiresApproval: false,
    };
    const planningService = {
      createPlan: vi.fn().mockResolvedValue(plan),
      createPlanResult: vi.fn().mockResolvedValue({
        plan,
        modelCall: {
          purpose: 'planning',
          execution: {
            executionId: 'plan-execution',
            mode: 'medium',
            provider: 'openai',
            model: 'gpt-4o',
            durationMs: 10,
            retries: 0,
            estimatedCost: 0,
          },
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      }),
    };
    const runsService = { savePlan: vi.fn().mockResolvedValue({}) };
    const service = new JaafarUnderstandingGraphService(
      contextLoader as never,
      understandingService as never,
      planningService as never,
      runsService as never,
    );

    const result = await service.build().invoke({
      input: { runId: 'run-1', agentId: 'agent-1', userMessage: 'Look up the account' },
    });

    expect(result.plan).toEqual(plan);
    expect(planningService.createPlanResult).toHaveBeenCalledWith(
      expect.objectContaining({ tools }),
    );
    expect(runsService.savePlan).toHaveBeenCalledWith('run-1', plan);
  });
});
