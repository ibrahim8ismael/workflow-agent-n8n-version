import { describe, expect, it, vi } from 'vitest';
import { EmployeeDesignSessionService } from './employee-design-session.service';
import { JaafarEmployeeDesignGraphService } from './jaafar-employee-design-graph.service';

const completeBlueprint = {
  ready: true,
  missingRequirements: [],
  name: 'Sales Assistant',
  role: 'Sales assistant',
  department: 'Sales',
  summary: 'Qualifies inbound sales leads.',
  responsibilities: ['Qualify inbound leads'],
  goals: ['Increase qualified opportunities'],
  knowledgeRequirements: ['Product catalog'],
  requiredTools: ['crm'],
  requiredIntegrations: ['crm'],
  channels: ['email'],
  memoryPolicy: 'Store durable lead preferences only.',
  permissions: ['Read and update leads'],
  workflow: ['Review and qualify each new lead'],
  description: 'An assistant for qualifying sales leads.',
  instructions: 'Qualify leads and record the outcome.',
};

function createService(
  objectResult = completeBlueprint,
  employeeDesignRuntime?: { confirm: ReturnType<typeof vi.fn> },
) {
  const runs = {
    create: vi.fn().mockResolvedValue({ id: 'run-1' }),
    transitionStatus: vi.fn(),
    updateUsage: vi.fn(),
    updateMetadata: vi.fn(),
    complete: vi.fn().mockResolvedValue({ id: 'run-1' }),
    fail: vi.fn(),
    findById: vi.fn().mockResolvedValue({ metadata: {} }),
  };
  const conversations = {
    findByIdInScope: vi.fn().mockResolvedValue({ metadata: {}, title: 'New chat' }),
    addMessage: vi.fn(),
    titleFromFirstMessage: vi.fn(),
    updateMetadata: vi.fn(),
  };
  const contextLoader = {
    load: vi.fn().mockResolvedValue({
      agent: { id: 'agent-1', name: 'Jaafar', instructions: 'Be concise.' },
      history: [],
      tools: [],
      memoryReferences: [],
      knowledgeReferences: [],
      readiness: [],
    }),
  };
  const contextBuilder = {
    build: vi.fn().mockResolvedValue({
      system: 'system',
      messages: [{ role: 'user', content: 'message' }],
    }),
  };
  const sessionService = new EmployeeDesignSessionService(conversations as never, runs as never);
  vi.spyOn(sessionService, 'persist');
  const llmRuntime = {
    generateObject: vi.fn().mockResolvedValue({
      object: objectResult,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      execution: { durationMs: 5, estimatedCost: 0.01 },
    }),
  };
  const service = new JaafarEmployeeDesignGraphService(
    runs as never,
    conversations as never,
    contextLoader as never,
    contextBuilder as never,
    sessionService as never,
    llmRuntime as never,
    employeeDesignRuntime as never,
  );
  return {
    service,
    runs,
    conversations,
    contextLoader,
    contextBuilder,
    sessionService,
    llmRuntime,
  };
}

describe('JaafarEmployeeDesignGraphService', () => {
  it('persists a complete blueprint and revision without creating an employee', async () => {
    const { service, runs, conversations, contextBuilder, sessionService, llmRuntime } =
      createService();

    const result = await service.run({
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'Build a sales assistant',
    });

    expect(result.status).toBe('WAITING');
    expect(result.plan).toMatchObject({
      name: 'Sales Assistant',
      ready: true,
      blueprintRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.response).toContain('Goals:');
    expect(result.response).toContain('Knowledge:');
    expect(result.response).toContain('Permissions and boundaries:');
    expect(result.response).toContain('Blueprint revision:');
    expect(contextBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        systemPrompt: expect.stringContaining('Current structured session'),
      }),
    );
    expect(llmRuntime.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ schema: expect.anything() }),
    );
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        designStatus: 'READY_FOR_REVIEW',
        blueprintRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(sessionService.persist).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ status: 'READY_FOR_REVIEW' }) }),
    );
    expect(conversations.addMessage).toHaveBeenCalledTimes(2);
    expect(runs.complete).not.toHaveBeenCalled();
  });

  it('resumes an approval checkpoint and delegates creation after approval', async () => {
    const employeeDesignRuntime = {
      confirm: vi.fn().mockResolvedValue({
        response: 'Employee draft was created.',
      }),
    };
    const runtime = createService(completeBlueprint, employeeDesignRuntime);

    const waiting = await runtime.service.run({
      agentId: 'agent-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'Build a sales assistant',
    });
    const result = await runtime.service.resume(
      'run-1',
      {
        approved: true,
        blueprintRevision: (waiting.plan as Record<string, unknown>).blueprintRevision as string,
      },
      { userId: 'user-1', organizationId: 'org-1' },
    );

    expect(waiting.status).toBe('WAITING');
    expect(result.status).toBe('COMPLETED');
    expect(employeeDesignRuntime.confirm).toHaveBeenCalledWith(
      'run-1',
      { userId: 'user-1', organizationId: 'org-1' },
      expect.objectContaining({ blueprintRevision: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
    expect(runtime.runs.complete).toHaveBeenCalledWith('run-1', 'Employee draft was created.');
  });

  it('rejects the approval checkpoint without invoking employee creation', async () => {
    const employeeDesignRuntime = { confirm: vi.fn() };
    const runtime = createService(completeBlueprint, employeeDesignRuntime);

    await runtime.service.run({
      agentId: 'agent-1',
      userId: 'user-1',
      userMessage: 'Build a sales assistant',
    });
    const result = await runtime.service.resume('run-1', {
      approved: false,
      reason: 'Please revise the responsibilities first.',
    });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('revise the responsibilities');
    expect(employeeDesignRuntime.confirm).not.toHaveBeenCalled();
    expect(runtime.runs.fail).toHaveBeenCalledWith(
      'run-1',
      'Please revise the responsibilities first.',
    );
  });

  it('keeps the session in requirement collection when backend validation finds gaps', async () => {
    const { service, runs } = createService({ ...completeBlueprint, ready: true, goals: [] });

    const result = await service.run({
      agentId: 'agent-1',
      userMessage: 'Continue designing it',
    });

    expect(result.plan).toMatchObject({ ready: false, missingRequirements: ['goals'] });
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        designStatus: 'GATHERING_REQUIREMENTS',
        approvalStatus: 'NOT_READY',
      }),
    );
    expect(result.response).toContain('goals');
  });

  it('loads a scoped conversation session before generating the next turn', async () => {
    const { service, contextLoader, conversations } = createService();

    await service.run({
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'Add the missing details',
    });

    expect(conversations.findByIdInScope).toHaveBeenCalledWith('conversation-1', {
      userId: 'user-1',
      organizationId: 'org-1',
    });
    expect(contextLoader.load).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'employee_design',
        userId: 'user-1',
        organizationId: 'org-1',
      }),
    );
  });
});
