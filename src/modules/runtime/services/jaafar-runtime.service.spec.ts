import { describe, expect, it, vi } from 'vitest';
import { JaafarRuntimeService } from './jaafar-runtime.service';

function createService() {
  const runtime = {
    approve: vi.fn().mockResolvedValue({ runId: 'legacy-run', status: 'COMPLETED', usage: {} }),
    reject: vi.fn().mockResolvedValue({ runId: 'legacy-run', status: 'CANCELLED', usage: {} }),
  };
  const runs = {
    findById: vi.fn().mockResolvedValue({ id: 'task-run', status: 'EXECUTING', metadata: {} }),
    findLatestWaitingInConversation: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'task-run' }),
    transitionStatus: vi.fn(),
    updateMetadata: vi.fn(),
    fail: vi.fn(),
    complete: vi.fn().mockResolvedValue({ id: 'task-run' }),
  };
  const automationGraph = {
    run: vi
      .fn()
      .mockResolvedValue({ runId: 'task-run', status: 'WAITING', response: '', usage: {} }),
    resume: vi
      .fn()
      .mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', response: 'Done', usage: {} }),
    retryFromFailure: vi
      .fn()
      .mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', response: 'Done', usage: {} }),
    provisionDeferred: vi
      .fn()
      .mockResolvedValue({ runId: 'task-run', status: 'COMPLETED', response: 'Done', usage: {} }),
    stream: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'run.waiting', runId: 'task-run', reason: 'approval' };
      })(),
    ),
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
  const conversations = {
    addMessage: vi.fn().mockResolvedValue(undefined),
    titleFromFirstMessage: vi.fn().mockResolvedValue(undefined),
  };
  const service = new JaafarRuntimeService(
    runtime as never,
    runs as never,
    conversations as never,
    automationGraph as never,
    executionGraph as never,
    conversationGraph as never,
    jaafarGraph as never,
  );
  return {
    service,
    runtime,
    runs,
    conversations,
    automationGraph,
    understandingGraph,
    executionGraph,
    conversationGraph,
    jaafarGraph,
  };
}

describe('JaafarRuntimeService', () => {
  it('starts explicit automation-design requests on the graph branch', async () => {
    const { service, automationGraph, jaafarGraph } = createService();
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
    expect(result.status).toBe('WAITING');
    expect(automationGraph.run).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'Design an invoice automation', runId: 'task-run' }),
    );
  });

  it('uses the conversation graph when classification is unavailable', async () => {
    const { service, conversationGraph, automationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockRejectedValue(new Error('classifier unavailable'));

    const result = await service.start({ agentId: 'agent-1', userMessage: 'What is our policy?' });

    expect(result.runId).toBe('task-run');
    expect(conversationGraph.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'conversation' }),
    );
    expect(automationGraph.run).not.toHaveBeenCalled();
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
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'automation_design' },
    });

    const result = await service.approve('task-run', { approved: true }, { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(automationGraph.resume).toHaveBeenCalledWith(
      'task-run',
      expect.objectContaining({ approved: true }),
      { userId: 'user-1' },
    );
    // V2 owns the WAITING status — no legacy pre-transition for design runs.
    expect(runs.transitionStatus).not.toHaveBeenCalledWith('task-run', 'EXECUTING');
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

  it('streams the clarification question as content and persists the turn', async () => {
    const { service, runs, conversations, conversationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: {
        route: 'clarification',
        intent: 'automation_design',
        clarificationQuestion: 'Which number should receive the messages?',
        missingInputs: [],
      },
    });

    const events = [];
    for await (const event of service.stream({
      agentId: 'agent-1',
      userMessage: 'yeah create it',
      conversationId: 'conv-1',
      userId: 'user-1',
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      type: 'token',
      payload: { content: 'Which number should receive the messages?' },
    });
    expect(events.at(-1)?.type).toBe('run.waiting');
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'task-run',
      expect.objectContaining({
        clarificationQuestion: 'Which number should receive the messages?',
      }),
    );
    expect(runs.transitionStatus).toHaveBeenCalledWith('task-run', 'WAITING');
    expect(conversations.addMessage).toHaveBeenCalledTimes(2);
    expect(runs.cancel).not.toHaveBeenCalled();
    expect(conversationGraph.stream).not.toHaveBeenCalled();
  });

  it('cancels the orchestration run when the classifier fails before degrading to conversation', async () => {
    const { service, runs, conversationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockRejectedValue(new Error('provider down'));

    const events = [];
    for await (const event of service.stream({ agentId: 'agent-1', userMessage: 'hello' })) {
      events.push(event);
    }

    expect(runs.cancel).toHaveBeenCalledWith('task-run');
    expect(events.map((event) => event.type)).toContain('run.completed');
    expect(conversationGraph.stream).toHaveBeenCalled();
  });

  it('parks automation design runs in WAITING when the V2 graph awaits approval', async () => {
    const { service, runs, automationGraph, jaafarGraph } = createService();
    jaafarGraph.classify.mockResolvedValue({
      understanding: { route: 'automation_design', intent: 'automation_design' },
    });
    automationGraph.stream.mockReturnValue(
      (async function* () {
        yield { type: 'run.started', runId: 'task-run' };
        yield { type: 'token', runId: 'task-run', content: 'Planning the automation ✓\n' };
        yield { type: 'run.waiting', runId: 'task-run', reason: 'approval' };
      })(),
    );

    const events = [];
    for await (const event of service.stream({
      agentId: 'agent-1',
      userMessage: 'build it',
      conversationId: 'conv-1',
      userId: 'user-1',
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['run.started', 'token', 'run.waiting']);
    expect(events[1]).toMatchObject({ payload: { content: 'Planning the automation ✓\n' } });
    expect(runs.transitionStatus).toHaveBeenCalledWith('task-run', 'WAITING');
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

  it('approves a WAITING V2 design by resuming the graph', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'automation_design', automationV2: true },
    });

    const result = await service.approve('task-run', { approved: true }, { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(automationGraph.resume).toHaveBeenCalledWith(
      'task-run',
      expect.objectContaining({ approved: true }),
      { userId: 'user-1' },
    );
  });

  it('rejects a WAITING V2 design without provisioning', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'automation_design', automationV2: true },
    });

    const result = await service.reject('task-run', 'Too risky', { userId: 'user-1' });

    expect(result.status).toBe('CANCELLED');
    expect(automationGraph.resume).not.toHaveBeenCalled();
  });

  it('fails approval for design runs that are no longer waiting', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'COMPLETED',
      metadata: { runtimeMode: 'automation_design', automationV2: true },
    });
    automationGraph.resume.mockResolvedValue({
      runId: 'task-run',
      status: 'FAILED',
      response: 'This automation is no longer waiting for approval (status=COMPLETED).',
      usage: {},
    });

    const result = await service.approve('task-run', { approved: true }, { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('no longer waiting');
  });

  it('rejects approval outside the run scope', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      userId: 'owner-1',
      metadata: { runtimeMode: 'automation_design' },
    });

    const result = await service.approve('task-run', { approved: true }, { userId: 'intruder' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('scope does not match');
    expect(automationGraph.resume).not.toHaveBeenCalled();
  });

  it('retries a failed automation run from its failed stage', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'FAILED',
      metadata: { runtimeMode: 'automation_design', automationV2: true },
    });
    automationGraph.retryFromFailure = vi.fn().mockResolvedValue({
      runId: 'task-run',
      status: 'COMPLETED',
      response: 'Automation is now ACTIVE',
      usage: {},
    });

    const result = await service.retryAutomation('task-run', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(automationGraph.retryFromFailure).toHaveBeenCalledWith('task-run', {
      userId: 'user-1',
    });
  });

  it('refuses to retry non-automation runs', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'COMPLETED',
      metadata: { runtimeMode: 'conversation' },
    });

    const result = await service.retryAutomation('task-run', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('Only automation runs can be retried');
    expect(automationGraph.retryFromFailure).not.toHaveBeenCalled();
  });

  it('builds a deferred automation draft without replanning', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'automation_design', automationV2: true },
    });
    automationGraph.provisionDeferred = vi.fn().mockResolvedValue({
      runId: 'task-run',
      status: 'COMPLETED',
      response: 'Automation is now ACTIVE',
      usage: {},
    });

    const result = await service.buildDeferredAutomation('task-run', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(automationGraph.provisionDeferred).toHaveBeenCalledWith('task-run', {
      userId: 'user-1',
    });
  });

  it('refuses to build deferred drafts for non-automation runs', async () => {
    const { service, runs, automationGraph } = createService();
    runs.findById.mockResolvedValue({
      status: 'WAITING',
      metadata: { runtimeMode: 'conversation' },
    });

    const result = await service.buildDeferredAutomation('task-run', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('Only deferred automation plans can be built');
    expect(automationGraph.provisionDeferred).not.toHaveBeenCalled();
  });
});
