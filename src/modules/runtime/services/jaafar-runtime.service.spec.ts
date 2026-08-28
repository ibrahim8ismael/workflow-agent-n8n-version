import { describe, expect, it, vi } from 'vitest';
import { JaafarRuntimeService } from './jaafar-runtime.service';

function createService() {
  const runtime = {
    approve: vi.fn().mockResolvedValue({ runId: 'legacy-run', status: 'COMPLETED', usage: {} }),
    reject: vi.fn().mockResolvedValue({ runId: 'legacy-run', status: 'CANCELLED', usage: {} }),
  };
  const runs = {
    findById: vi.fn(),
    cancel: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'task-run' }),
    transitionStatus: vi.fn(),
    updateMetadata: vi.fn(),
    fail: vi.fn(),
    complete: vi.fn().mockResolvedValue({ id: 'task-run' }),
  };
  const employeeDesignGraph = {
    run: vi.fn().mockResolvedValue({ runId: 'task-run', status: 'WAITING', usage: {} }),
    resume: vi.fn().mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', usage: {} }),
    build: vi.fn().mockReturnValue({
      invoke: vi
        .fn()
        .mockResolvedValue({ route: 'completed', response: 'Employee created.', usage: {} }),
      stream: vi.fn().mockReturnValue(
        (async function* () {
          yield {
            type: 'run.completed',
            runId: 'task-run',
            response: 'Employee created.',
            usage: {},
          };
        })(),
      ),
    }),
    graphConfig: vi.fn().mockReturnValue({ configurable: { thread_id: 'test' } }),
  };
  const understandingGraph = { build: vi.fn() };
  const executionGraph = {
    build: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        route: 'completed',
        response: 'Account found.',
        modelCalls: [],
        usage: {},
      }),
      stream: vi.fn().mockReturnValue(
        (async function* () {
          yield { type: 'run.completed', runId: 'task-run', response: 'Finished', usage: {} };
        })(),
      ),
    }),
    stream: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'run.completed', runId: 'task-run', response: 'Finished', usage: {} };
      })(),
    ),
    resume: vi
      .fn()
      .mockResolvedValue({ route: 'completed', response: 'Resumed.', modelCalls: [], usage: {} }),
    graphConfig: vi.fn().mockReturnValue({ configurable: { thread_id: 'test' } }),
  };
  const conversationGraph = {
    run: vi.fn().mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', usage: {} }),
    stream: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'run.started', runId: 'stream-run' };
        yield { type: 'graph.node.started', runId: 'stream-run', node: 'load_context' };
        yield { type: 'token', runId: 'stream-run', content: 'Hello' };
        yield {
          type: 'run.completed',
          runId: 'stream-run',
          response: 'Hello',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      })(),
    ),
    build: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        response: 'Hello',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        execution: {},
      }),
    }),
  };
  const jaafarGraph = {
    classify: vi.fn().mockResolvedValue({
      route: 'task_execution',
      understanding: { route: 'task_execution', intent: 'task_execution' },
      context: { skills: [] },
      plan: {
        schemaVersion: 1,
        goal: 'Test',
        steps: [],
        successCriteria: [],
        requiresApproval: false,
      },
      modelCalls: [],
    }),
  };
  const employeeDesignRuntime = {
    confirm: vi
      .fn()
      .mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', response: 'Created.' }),
  };
  const service = new JaafarRuntimeService(
    runtime as never,
    runs as never,
    employeeDesignRuntime as never,
    employeeDesignGraph as never,
    executionGraph as never,
    conversationGraph as never,
    jaafarGraph as never,
  );
  return {
    service,
    runtime,
    runs,
    employeeDesignRuntime,
    employeeDesignGraph,
    understandingGraph,
    executionGraph,
    conversationGraph,
    jaafarGraph,
  };
}

describe('JaafarRuntimeService', () => {
  it('starts explicit employee-design requests on the graph branch', async () => {
    const { service, employeeDesignGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      route: 'employee_design',
      understanding: { route: 'employee_design' },
    });

    const result = await service.start({
      agentId: 'agent-1',
      userMessage: 'Design an HR employee',
      mode: 'employee_design',
    });

    expect(result.runId).toBe('task-run');
    expect(employeeDesignGraph.build().invoke).toHaveBeenCalled();
  });

  it('uses the conversation graph when classification is unavailable', async () => {
    const { service, conversationGraph, employeeDesignGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockRejectedValue(new Error('classifier unavailable'));

    const result = await service.start({ agentId: 'agent-1', userMessage: 'What is our policy?' });

    expect(result.runId).toBe('task-run');
    expect(conversationGraph.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'conversation' }),
    );
    expect(employeeDesignGraph.run).not.toHaveBeenCalled();
  });

  it('classifies ordinary conversation and uses the conversation graph', async () => {
    const { service, conversationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'general_question', intent: 'general_question' },
    });

    const result = await service.start({ agentId: 'agent-1', userMessage: 'What is our policy?' });

    expect(result.runId).toBe('task-run');
    expect(conversationGraph.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'conversation' }),
    );
  });

  it('does not fall back after the graph conversation run has started', async () => {
    const { service, conversationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'general_question', intent: 'general_question' },
    });
    conversationGraph.run.mockRejectedValue(new Error('graph provider failed'));

    await expect(
      service.start({ agentId: 'agent-1', userMessage: 'What is our policy?' }),
    ).rejects.toThrow('graph provider failed');
  });

  it('resumes graph-owned employee designs through approval', async () => {
    const { service, runs, employeeDesignGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'employee_design' },
    });

    const result = await service.approve('task-run', { approved: true }, { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(employeeDesignGraph.resume).toHaveBeenCalledWith(
      'task-run',
      { approved: true, blueprintRevision: '' },
      { userId: 'user-1' },
    );
  });

  it('keeps legacy approval behavior for non-graph runs', async () => {
    const { service, runs, runtime } = createService();
    runs.findById.mockResolvedValue({ status: 'WAITING', metadata: { runtimeMode: 'execution' } });

    await service.approve('legacy-run', { approved: true });

    expect(runtime.approve).toHaveBeenCalledWith('legacy-run');
  });

  it('runs explicit task execution through understanding and execution graphs', async () => {
    const { service, jaafarGraph, executionGraph } = createService();
    const plan = {
      schemaVersion: 1,
      goal: 'Look up the account',
      steps: [],
      successCriteria: ['Account found'],
      requiresApproval: false,
    };
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'task_execution', intent: 'task_execution' },
      context: { skills: [{ id: 'lookup' }] },
      plan,
    });
    executionGraph.build.mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        route: 'completed',
        response: 'Account found.',
        modelCalls: [],
        usage: {},
      }),
    });

    const result = await service.start({
      agentId: 'agent-1',
      userMessage: 'Look up the account',
      mode: 'execution',
    });

    expect(result.status).toBe('COMPLETED');
    expect(jaafarGraph.classify).toHaveBeenCalled();
    expect(executionGraph.build).toHaveBeenCalled();
  });

  it('normalizes graph conversation stream events', async () => {
    const { service, conversationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'general_question', intent: 'general_question' },
    });
    conversationGraph.stream.mockReturnValue(
      (async function* () {
        yield { type: 'run.started', runId: 'stream-run' };
        yield { type: 'graph.node.started', runId: 'stream-run', node: 'load_context' };
        yield { type: 'token', runId: 'stream-run', content: 'Hello' };
        yield {
          type: 'run.completed',
          runId: 'stream-run',
          response: 'Hello',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      })(),
    );

    const events = [];
    for await (const event of service.stream({ agentId: 'agent-1', userMessage: 'Say hello' })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'graph.node.started',
      'token',
      'run.completed',
    ]);
    expect(events[2]).toMatchObject({ payload: { content: 'Hello' } });
  });

  it('streams explicit execution runs through the task graph', async () => {
    const { service, runs, jaafarGraph, executionGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'task_execution', intent: 'task_execution' },
      context: { skills: [] },
      plan: {
        schemaVersion: 1,
        goal: 'Run it',
        steps: [],
        successCriteria: [],
        requiresApproval: false,
      },
    });
    executionGraph.stream = vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'run.started', runId: 'task-run' };
        yield { type: 'run.completed', runId: 'task-run', response: 'Finished' };
      })(),
    );

    const events = [];
    for await (const event of service.stream({
      agentId: 'agent-1',
      userMessage: 'Run it',
      mode: 'execution',
    })) {
      events.push(event.type);
    }

    expect(runs.create).toHaveBeenCalled();
    expect(events).toEqual(['run.started', 'run.completed']);
  });

  it('marks a task run failed when streaming the graph throws', async () => {
    const { service, runs, jaafarGraph, executionGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'task_execution', intent: 'task_execution' },
      context: { skills: [] },
      plan: {
        schemaVersion: 1,
        goal: 'Run it',
        steps: [],
        successCriteria: [],
        requiresApproval: false,
      },
    });
    executionGraph.stream = vi.fn().mockReturnValue(
      (async function* () {
        yield* [];
        throw new Error('graph provider failed');
      })(),
    );

    const events = [];
    for await (const event of service.stream({
      agentId: 'agent-1',
      userMessage: 'Run it',
      mode: 'execution',
    })) {
      events.push(event);
    }

    expect(runs.fail).toHaveBeenCalledWith('task-run', 'graph provider failed');
    expect(events.at(-1)?.type).toBe('run.failed');
  });

  it('confirms graph employee design by resuming the graph when status is WAITING', async () => {
    const { service, runs, employeeDesignGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'employee_design', blueprintRevision: 'rev-1' },
    });

    const result = await service.confirmEmployeeDesign(
      'task-run',
      { userId: 'user-1' },
      { blueprintRevision: 'rev-1' },
    );

    expect(result.status).toBe('COMPLETED');
    expect(employeeDesignGraph.resume).toHaveBeenCalledWith(
      'task-run',
      { approved: true, blueprintRevision: 'rev-1' },
      { userId: 'user-1' },
    );
  });

  it('confirms employee design when metadata has employeeDesign even if runtimeMode was conversation', async () => {
    const { service, runs, employeeDesignGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'conversation', employeeDesign: { status: 'READY_FOR_REVIEW' } },
    });

    const result = await service.confirmEmployeeDesign('task-run', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(employeeDesignGraph.resume).toHaveBeenCalled();
  });

  it('falls back to employeeDesignRuntime when run is not waiting on graph', async () => {
    const { service, runs, employeeDesignRuntime } = createService();
    runs.findById.mockResolvedValue({
      status: 'COMPLETED',
      metadata: { blueprint: { name: 'Accountant' } },
    });

    const result = await service.confirmEmployeeDesign('task-run', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(employeeDesignRuntime.confirm).toHaveBeenCalledWith(
      'task-run',
      { userId: 'user-1' },
      undefined,
    );
  });
});
