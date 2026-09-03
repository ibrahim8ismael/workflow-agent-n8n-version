import { describe, expect, it, vi } from 'vitest';
import { JaafarRuntimeService } from './jaafar-runtime.service';

function createService() {
  const runtime = {
    approve: vi.fn().mockResolvedValue({ runId: 'legacy-run', status: 'COMPLETED', usage: {} }),
    reject: vi.fn().mockResolvedValue({ runId: 'legacy-run', status: 'CANCELLED', usage: {} }),
  };
  const runs = {
    findById: vi.fn(),
    findLatestWaitingInConversation: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'task-run' }),
    transitionStatus: vi.fn(),
    updateMetadata: vi.fn(),
    fail: vi.fn(),
    complete: vi.fn().mockResolvedValue({ id: 'task-run' }),
  };
  const automationDesignGraph = {
    run: vi.fn().mockResolvedValue({ runId: 'task-run', status: 'WAITING', usage: {} }),
    resume: vi.fn().mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', usage: {} }),
    build: vi.fn().mockReturnValue({
      invoke: vi
        .fn()
        .mockResolvedValue({ route: 'completed', response: 'Automation provisioned.', usage: {} }),
      stream: vi.fn().mockReturnValue(
        (async function* () {
          yield {
            type: 'run.completed',
            runId: 'task-run',
            response: 'Automation provisioned.',
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
  const service = new JaafarRuntimeService(
    runtime as never,
    runs as never,
    automationDesignGraph as never,
    executionGraph as never,
    conversationGraph as never,
    jaafarGraph as never,
  );
  return {
    service,
    runtime,
    runs,
    automationDesignGraph,
    understandingGraph,
    executionGraph,
    conversationGraph,
    jaafarGraph,
  };
}

describe('JaafarRuntimeService', () => {
  it('starts explicit automation-design requests on the graph branch', async () => {
    const { service, automationDesignGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      route: 'automation_design',
      understanding: { route: 'automation_design' },
    });

    const result = await service.start({
      agentId: 'agent-1',
      userMessage: 'Design an invoice automation',
      mode: 'automation_design',
    });

    expect(result.runId).toBe('task-run');
    expect(automationDesignGraph.build().invoke).toHaveBeenCalled();
  });

  it('uses the conversation graph when classification is unavailable', async () => {
    const { service, conversationGraph, automationDesignGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockRejectedValue(new Error('classifier unavailable'));

    const result = await service.start({ agentId: 'agent-1', userMessage: 'What is our policy?' });

    expect(result.runId).toBe('task-run');
    expect(conversationGraph.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'conversation' }),
    );
    expect(automationDesignGraph.run).not.toHaveBeenCalled();
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

  it('attaches the pending follow-up question when a prior run is still WAITING', async () => {
    const { service, runs, jaafarGraph } = createService();
    runs.findLatestWaitingInConversation.mockResolvedValue({
      id: 'prior-run',
      userId: null,
      organizationId: null,
      metadata: {
        userMessage: 'build a WhatsApp automation',
        clarificationQuestion: 'Which number should receive the messages?',
        intent: 'automation_design',
      },
    });
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'automation_design', intent: 'automation_design' },
    });

    await service.start({
      agentId: 'agent-1',
      userMessage: '+212600000000',
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    expect(jaafarGraph.classify).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingContext: expect.objectContaining({
          question: 'Which number should receive the messages?',
          intent: 'automation_design',
        }),
      }),
    );
  });

  it('omits pending context when nothing is waiting', async () => {
    const { service, runs, jaafarGraph } = createService();
    runs.findLatestWaitingInConversation.mockResolvedValue(null);
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'general_question', intent: 'general_question' },
    });

    await service.start({
      agentId: 'agent-1',
      userMessage: 'hello',
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    expect(jaafarGraph.classify).toHaveBeenCalledWith(
      expect.not.objectContaining({ pendingContext: expect.anything() }),
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

  it('resumes graph-owned automation designs through approval', async () => {
    const { service, runs, automationDesignGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'automation_design' },
    });

    const result = await service.approve('task-run', { approved: true }, { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(automationDesignGraph.resume).toHaveBeenCalledWith(
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

  it('confirms graph automation design by resuming the graph when status is WAITING', async () => {
    const { service, runs, automationDesignGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'automation_design', blueprintRevision: 'rev-1' },
    });

    const result = await service.confirmAutomationDesign(
      'task-run',
      { userId: 'user-1' },
      { blueprintRevision: 'rev-1' },
    );

    expect(result.status).toBe('COMPLETED');
    expect(automationDesignGraph.resume).toHaveBeenCalledWith(
      'task-run',
      { approved: true, blueprintRevision: 'rev-1' },
      { userId: 'user-1' },
    );
  });

  it('confirms automation design when metadata has automationDesign even if runtimeMode was conversation', async () => {
    const { service, runs, automationDesignGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'conversation', automationDesign: { status: 'READY_FOR_REVIEW' } },
    });

    const result = await service.confirmAutomationDesign('task-run', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(automationDesignGraph.resume).toHaveBeenCalled();
  });

  it('fails confirmation for completed non-graph runs', async () => {
    const { service, runs } = createService();
    runs.findById.mockResolvedValue({
      status: 'COMPLETED',
      metadata: { blueprint: { name: 'Accountant' } },
    });

    const result = await service.confirmAutomationDesign('task-run', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
  });

  it('explains that a conversation run has no blueprint to confirm', async () => {
    const { service, runs } = createService();
    runs.findById.mockResolvedValue({
      status: 'COMPLETED',
      metadata: { runtimeMode: 'conversation' },
    });

    const result = await service.confirmAutomationDesign('task-run', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('not an automation design');
    expect(result.error?.code).toBe('INVALID_REQUEST');
  });

  it('points execution WAITING runs at the approve endpoint', async () => {
    const { service, runs } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'execution', executionGraphInput: { plan: {} } },
    });

    const result = await service.confirmAutomationDesign('task-run', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('/runs/:id/approve');
  });
});
