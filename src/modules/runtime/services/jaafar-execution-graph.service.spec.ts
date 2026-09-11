import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolResult } from '../interfaces/tool.interface';
import { JaafarExecutionGraphService } from './jaafar-execution-graph.service';
import { HarnessLimitError, JaafarHarnessService } from './jaafar-harness.service';

const tool = (id: string): ToolDefinition => ({
  id,
  name: id,
  slug: id,
  description: id,
  executionMode: 'knowledge',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  requiredPermissions: [],
  requiredIntegrations: [],
  requiresApproval: false,
  sideEffect: false,
  timeoutMs: 1000,
  maxRetries: 0,
  retryPolicy: { maxAttempts: 1, retryableCodes: [] },
  idempotent: false,
  successCriteria: [],
  permissionScope: 'organization',
});

const result = (toolId: string, success: boolean, output?: unknown): ToolResult => ({
  callId: `run-1:${toolId}:step-${toolId}`,
  toolId,
  success,
  output: output as never,
  durationMs: 1,
  ...(success ? {} : { error: { code: 'TOOL_TIMEOUT', message: 'temporary', retryable: true } }),
});

const plan = {
  schemaVersion: 1,
  goal: 'Read two records',
  steps: [
    { stepId: 'step-a', toolId: 'tool-a', order: 0, input: {}, required: true },
    {
      stepId: 'step-b',
      toolId: 'tool-b',
      order: 1,
      input: {},
      required: true,
      dependsOn: ['step-a'],
    },
  ],
  successCriteria: ['Both records were read'],
  requiresApproval: false,
};

const harness = {
  assertWithinLimits: vi.fn(),
  getPolicy: vi.fn().mockReturnValue({ maxRetriesPerTool: 2 }),
};

const configHarness = (values: Record<string, unknown>) => {
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
  return new JaafarHarnessService(config);
};

const modelCall = {
  purpose: 'response',
  execution: {
    executionId: 'exec-1',
    mode: 'medium',
    provider: 'openai',
    model: 'gpt-4o',
    durationMs: 10,
    retries: 0,
    estimatedCost: 0.7,
  },
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
} as never;

describe('JaafarExecutionGraphService', () => {
  it('executes multiple planned tools and preserves all results', async () => {
    const executor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(result('tool-a', true, { id: 'a' }))
        .mockResolvedValueOnce(result('tool-b', true, { id: 'b' })),
    };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Read two records',
        tools: [tool('tool-a'), tool('tool-b')],
        plan,
      },
    });

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(output.stepIndex).toBe(2);
    expect(output.results).toHaveLength(2);
    expect(output.results[0].output).toEqual({ id: 'a' });
  });

  it('retries a retryable result and retains the failed observation', async () => {
    const executor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(result('tool-a', false))
        .mockResolvedValueOnce(result('tool-a', true, { recovered: true })),
    };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Read two records',
        tools: [tool('tool-a')],
        plan: { ...plan, steps: [plan.steps[0]] },
      },
    });

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(output.results).toHaveLength(2);
    expect(output.results[0].success).toBe(false);
    expect(output.results[1].success).toBe(true);
  });

  it('stops on an unavailable planned tool without invoking the executor', async () => {
    const executor = { execute: vi.fn() };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);

    const output = await service.build().invoke({
      input: { runId: 'run-1', agentId: 'agent-1', userMessage: 'Run it', tools: [], plan },
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(output.error?.code).toBe('TOOL_NOT_FOUND');
  });

  it('stops safely when the harness tool-call limit is reached', async () => {
    const executor = { execute: vi.fn() };
    const limitedHarness = {
      assertWithinLimits: vi.fn().mockImplementation(() => {
        throw new HarnessLimitError('maxToolCalls', 0, 1);
      }),
      getPolicy: vi.fn().mockReturnValue({ maxRetriesPerTool: 2 }),
    };
    const service = new JaafarExecutionGraphService(executor as never, limitedHarness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Run it',
        tools: [tool('tool-a')],
        plan,
      },
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(output.error?.code).toBe('GRAPH_LIMIT_REACHED');
  });

  it('completes a plan whose step count exactly matches maxGraphSteps', async () => {
    const limitedHarness = configHarness({ JAAFAR_MAX_GRAPH_STEPS: '2' });
    const executor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(result('tool-a', true, { id: 'a' }))
        .mockResolvedValueOnce(result('tool-b', true, { id: 'b' })),
    };
    const service = new JaafarExecutionGraphService(executor as never, limitedHarness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Read two records',
        tools: [tool('tool-a'), tool('tool-b')],
        plan,
      },
    });

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(output.error).toBeUndefined();
    expect(output.usage?.graphSteps).toBe(2);
  });

  it('enforces the runtime limit against the persisted graph start time', async () => {
    const limitedHarness = configHarness({ JAAFAR_MAX_RUNTIME_MS: '0' });
    const executor = {
      execute: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return result('tool-a', true, { id: 'a' });
      }),
    };
    const service = new JaafarExecutionGraphService(executor as never, limitedHarness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Run it',
        tools: [tool('tool-a')],
        plan: { ...plan, steps: [plan.steps[0]] },
      },
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(output.error?.code).toBe('GRAPH_LIMIT_REACHED');
  });

  it('does not consume the retry budget for non-retryable failures', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        ...result('tool-a', false),
        error: { code: 'PERMANENT_FAILURE', message: 'permanent', retryable: false },
      }),
    };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Run it',
        tools: [tool('tool-a')],
        plan: { ...plan, steps: [plan.steps[0]] },
      },
    });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(output.retriesByTool).toEqual({});
  });

  it('folds model-call cost and output tokens into harness usage', async () => {
    const finalResponse = {
      generate: vi.fn().mockResolvedValue({ response: 'done', modelCall }),
    };
    const executor = { execute: vi.fn().mockResolvedValue(result('tool-a', true, { id: 'a' })) };
    const service = new JaafarExecutionGraphService(
      executor as never,
      harness as never,
      finalResponse as never,
    );

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Read it',
        tools: [tool('tool-a')],
        plan: { ...plan, steps: [plan.steps[0]] },
      },
    });

    expect(finalResponse.generate).toHaveBeenCalledTimes(1);
    expect(output.usage?.estimatedCost).toBe(0.7);
    expect(output.usage?.outputTokens).toBe(20);
  });

  it('pauses when the executor reports that approval is required', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        ...result('tool-a', false),
        error: { code: 'APPROVAL_REQUIRED', message: 'Approve this action', retryable: false },
      }),
    };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);

    const output = await service.build().invoke({
      input: {
        runId: 'run-1',
        agentId: 'agent-1',
        userMessage: 'Run it',
        tools: [tool('tool-a')],
        plan,
      },
    });

    expect(output.route).toBe('waiting');
    expect(output.error?.code).toBe('APPROVAL_REQUIRED');
  });

  it('checkpoints before a side-effecting tool and resumes without reselecting the step', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue(result('tool-a', true, { created: true })),
    };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);
    const input = {
      runId: 'run-approval',
      agentId: 'agent-1',
      userMessage: 'Create it',
      tools: [tool('tool-a')].map((candidate) => ({ ...candidate, sideEffect: true })),
      plan: { ...plan, steps: [plan.steps[0]] },
      userId: 'user-1',
      organizationId: 'org-1',
    };

    const paused = await service
      .build({ durable: true })
      .invoke({ input }, service.graphConfig(input.runId, input));

    expect((paused as unknown as { __interrupt__?: unknown }).__interrupt__).toBeDefined();
    expect(executor.execute).not.toHaveBeenCalled();

    const resumed = await service.resume(input.runId, true, input);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(resumed.route).toBe('completed');
    expect(resumed.stepIndex).toBe(1);
  });

  it('scopes checkpoint thread IDs by organization and user', () => {
    const service = new JaafarExecutionGraphService({} as never, harness as never);

    expect(service.graphConfig('run-1', { userId: 'user-1', organizationId: 'org-1' })).toEqual({
      configurable: { thread_id: 'jaafar:execution:org-1:user-1:run-1' },
    });
  });

  it('streams tool lifecycle events for a non-approval execution', async () => {
    const executor = { execute: vi.fn().mockResolvedValue(result('tool-a', true, { id: 'a' })) };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);
    const events = [];
    for await (const event of service.stream({
      runId: 'run-stream',
      agentId: 'agent-1',
      userMessage: 'Read it',
      tools: [tool('tool-a')],
      plan: { ...plan, steps: [plan.steps[0]] },
    })) {
      events.push(event.type);
    }

    expect(events).toContain('tool.started');
    expect(events).toContain('tool.completed');
    expect(events).toContain('run.completed');
  });

  it('emits approval.required + run.waiting for the approval interrupt in the stream', async () => {
    // Regression: LangGraph 1.x emits interrupts as a TOP-LEVEL
    // { __interrupt__: [...] } update — the old node-level check never fired,
    // so approval streams hung with the run row stuck in EXECUTING.
    const executor = { execute: vi.fn() };
    const service = new JaafarExecutionGraphService(executor as never, harness as never);
    const events = [];
    for await (const event of service.stream({
      runId: 'run-approval-stream',
      agentId: 'agent-1',
      userMessage: 'Create it',
      tools: [tool('tool-a')].map((candidate) => ({ ...candidate, sideEffect: true })),
      plan: { ...plan, steps: [plan.steps[0]] },
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(expect.objectContaining({ type: 'approval.required' }));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'run.waiting', reason: 'approval' }),
    );
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
