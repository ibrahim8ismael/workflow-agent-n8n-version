import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_RUN_PHASE } from '../../runs/agent-run-phase';
import { JaafarAutomationGraphService } from './jaafar-automation-graph.service';

const blueprint = {
  ready: true,
  missingRequirements: [],
  name: 'Order sync',
  goal: 'Sync orders',
  summary: 'Syncs new orders',
  description: '',
  trigger: { type: 'webhook', config: {} },
  steps: [
    {
      id: 'S1',
      name: 'Receive order',
      action: 'Receive the order',
      config: {},
      requirementIds: ['R1'],
      expectedOutput: 'order payload',
      nodeHint: { type: 'n8n-nodes-base.webhook', parameters: {} },
    },
  ],
  integrations: [],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
};

const understanding = {
  route: 'automation_design',
  intent: 'automation_design',
  goal: 'Sync orders',
  businessContext: '',
  trigger: { kind: 'webhook', event: 'order.created', schedule: '' },
  actions: ['sync'],
  entities: [],
  conditions: [],
  constraints: [],
  desiredOutcome: '',
  requirements: [{ id: 'R1', field: 'sync', value: 'orders', required: true, source: 'user' }],
  assumptions: [],
  missingInputs: [],
  confidence: 0.9,
  clarificationRequired: false,
  modelCall: {
    purpose: 'understanding',
    execution: {},
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  },
};

describe('JaafarAutomationGraphService', () => {
  const agentRuns = {
    createAgentRun: vi.fn(),
    advance: vi.fn(),
    recordArtifacts: vi.fn(),
    appendRepairAttempt: vi.fn(),
    isRepairable: vi.fn(),
    snapshot: vi.fn(),
  };
  const runs = {
    updateMetadata: vi.fn(),
    recordModelUsage: vi.fn(),
    fail: vi.fn(),
    findById: vi.fn(),
  };
  const conversations = { addMessage: vi.fn(), titleFromFirstMessage: vi.fn() };
  const contextManager = {
    buildForStage: vi.fn(),
    renderToPromptText: vi.fn().mockReturnValue('context'),
  };
  const contextLoader = { load: vi.fn() };
  const understandingService = { understand: vi.fn() };
  const registry = { capabilitiesForScope: vi.fn() };
  const planReview = { review: vi.fn() };
  const builder = { validateOnly: vi.fn(), build: vi.fn() };
  const validator = { validate: vi.fn() };
  const repair = { diagnoseAndPatch: vi.fn(), needsPatch: vi.fn(), escalationMessage: vi.fn() };
  const classifier = { classify: vi.fn() };
  const llmRuntime = { generateObject: vi.fn() };
  const clientApi = { getWorkflow: vi.fn() };
  const n8nConnections = { resolveActiveForScope: vi.fn() };
  const nodeInventory = { inventory: vi.fn() };

  const service = () =>
    new JaafarAutomationGraphService(
      agentRuns as never,
      runs as never,
      conversations as never,
      contextManager as never,
      contextLoader as never,
      understandingService as never,
      registry as never,
      planReview as never,
      builder as never,
      validator as never,
      repair as never,
      classifier as never,
      llmRuntime as never,
      clientApi as never,
      n8nConnections as never,
      nodeInventory as never,
    );

  const input = (overrides = {}) => ({
    agentId: 'agent-1',
    userMessage: 'Sync my orders',
    conversationId: 'conv-1',
    userId: 'user-1',
    organizationId: 'org-1',
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    contextManager.renderToPromptText.mockReturnValue('context');
    agentRuns.createAgentRun.mockResolvedValue({ id: 'run-1' });
    agentRuns.advance.mockImplementation(async (_id: string, change: Record<string, unknown>) =>
      Promise.resolve({ id: 'run-1', ...change }),
    );
    agentRuns.snapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'WAITING',
        currentPhase: AGENT_RUN_PHASE.STATIC_VALIDATION,
        metadata: { automationV2: true },
      },
      transitions: [],
    });
    runs.findById.mockResolvedValue({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    contextLoader.load.mockResolvedValue({
      agent: { name: 'Jaafar', instructions: 'Be kind' },
      history: [],
      tools: [],
      memoryReferences: [],
      knowledgeReferences: [],
      readiness: [],
    });
    understandingService.understand.mockResolvedValue(understanding);
    registry.capabilitiesForScope.mockResolvedValue([]);
    llmRuntime.generateObject.mockResolvedValue({
      object: blueprint,
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    });
    planReview.review.mockImplementation(
      ({ blueprint: inputBlueprint }: { blueprint: unknown }) => ({
        blueprint: inputBlueprint,
        valid: true,
        errors: [],
        warnings: [],
        coverage: [],
        readinessBlockers: [],
      }),
    );
    builder.validateOnly.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
      coverage: [],
      readinessBlockers: [],
    });
    builder.build.mockResolvedValue({
      automation: {
        id: 'auto-1',
        status: 'ACTIVE',
        externalWorkflowId: 'wf-1',
        webhookPath: 'orders-auto',
        version: 1,
        buildable: true,
        readyToRun: true,
        readinessBlockers: [],
      },
      validation: { valid: true },
    });
    validator.validate.mockResolvedValue({
      ok: true,
      checks: [{ name: 'workflow_responded', passed: true }],
      durationMs: 5,
      testInput: { test: true },
    });
    repair.needsPatch.mockReturnValue(true);
    repair.diagnoseAndPatch.mockResolvedValue({
      blueprint,
      diagnosis: 'Fixed the expression',
      changes: ['closed delimiter'],
      retryUnchanged: false,
    });
    repair.escalationMessage.mockReturnValue('Escalation message');
    classifier.classify.mockReturnValue({
      code: 'INVALID_EXPRESSION',
      retryable: false,
      repairStrategy: 'patch_expression',
      summary: 'Bad expression.',
    });
    n8nConnections.resolveActiveForScope.mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'https://n8n.example.com',
      apiKey: 'sk',
    });
    clientApi.getWorkflow.mockResolvedValue({
      id: 'wf-1',
      name: 'Flow',
      active: true,
      nodes: [{ type: 'n8n-nodes-base.webhook' }],
    });
  });

  it('runs the full pipeline to a verified COMPLETED automation', async () => {
    const result = await service().run(input());

    // Stops at the approval gate.
    expect(result.status).toBe('WAITING');
    expect(agentRuns.createAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
    );
    // Phase walk: UNDERSTANDING handled at creation; PLANNING →
    // STATIC_VALIDATION → BUILDING recorded (BUILDING only after validation
    // passes, so replans never need BUILDING → PLANNING); WAITING parked.
    const phases = agentRuns.advance.mock.calls.map((call) => call[1].toPhase).filter(Boolean);
    expect(phases).toEqual([
      AGENT_RUN_PHASE.PLANNING,
      AGENT_RUN_PHASE.STATIC_VALIDATION,
      AGENT_RUN_PHASE.BUILDING,
    ]);
    expect(conversations.addMessage).not.toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ role: 'user' }),
    );
  });

  it('resumes an approved design through provision + verify to COMPLETED', async () => {
    // Prime the checkpoint by running to the gate first.
    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.response).toContain('ACTIVE');
    expect(resumed.response).toContain('no success was reported before verification');
    expect(builder.build).toHaveBeenCalled();
    const phases = agentRuns.advance.mock.calls.map((call) => call[1].toPhase).filter(Boolean);
    expect(phases).toContain(AGENT_RUN_PHASE.EXECUTING);
    expect(phases).toContain(AGENT_RUN_PHASE.COMPLETED);
  });

  it('fails the run with the human reason on rejection — nothing provisioned', async () => {
    const svc = service();
    await svc.run(input());
    const rejected = await svc.resume('run-1', { approved: false, reason: 'Too risky' });

    expect(rejected.status).toBe('FAILED');
    expect(rejected.response).toBe('Too risky');
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('asks for confirmation instead of planning when understanding clarifies', async () => {
    understandingService.understand.mockResolvedValue({
      ...understanding,
      route: 'clarification',
      clarificationRequired: true,
      clarificationQuestion: 'Which channel?',
    });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(result.response).toBe('Which channel?');
    expect(llmRuntime.generateObject).not.toHaveBeenCalled();
  });

  it('replans once with review feedback, then throws on a second rejection', async () => {
    planReview.review
      .mockReturnValueOnce({
        blueprint,
        valid: false,
        errors: [{ code: 'UNCOVERED_REQUIREMENT', message: 'R1 uncovered' }],
        warnings: [],
        coverage: [],
      })
      .mockReturnValue({
        blueprint,
        valid: false,
        errors: [{ code: 'UNCOVERED_REQUIREMENT', message: 'R1 still uncovered' }],
        warnings: [],
        coverage: [],
      });

    await expect(service().run(input())).rejects.toThrow('failed review twice');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
  });

  it('fails verifiably when static validation rejects the plan', async () => {
    builder.validateOnly.mockResolvedValue({
      valid: false,
      errors: [{ code: 'INVALID_PLAN', message: 'bad node' }],
      warnings: [],
      coverage: [],
    });

    await expect(service().run(input())).rejects.toThrow('static validation');
    expect(agentRuns.advance).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ toPhase: AGENT_RUN_PHASE.FAILED, toStatus: 'FAILED' }),
    );
  });

  it('streams phase progress tokens to approval', async () => {
    const events = [];
    for await (const event of service().stream(input())) events.push(event);

    expect(events[0]).toMatchObject({ type: 'run.started', runId: 'run-1' });
    const tokens = events
      .filter((e) => e.type === 'token')
      .map((e) => (e as { content: string }).content)
      .join('');
    expect(tokens).toContain('Understanding your request');
    expect(tokens).toContain('Planning the automation');
    expect(tokens).toContain('Draft automation blueprint: Order sync');
    expect(events.at(-1)).toMatchObject({ type: 'run.waiting', reason: 'approval' });
    // User turn persisted before generation (never lost on failure).
    expect(conversations.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ role: 'user', content: 'Sync my orders' }),
    );
  });

  it('refuses to resume pre-V2 runs with the restate message', async () => {
    agentRuns.snapshot.mockResolvedValue({
      run: { id: 'old-1', userId: 'user-1', status: 'WAITING', metadata: {} },
      transitions: [],
    });

    const result = await service().resume('old-1', { approved: true }, { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('restate your request');
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('asks to clarify unknown integrations instead of burning the replan budget', async () => {
    planReview.review.mockReturnValue({
      blueprint,
      valid: false,
      errors: [
        {
          code: 'UNKNOWN_INTEGRATION',
          message: 'Integration "fakecrmpro" is not a known provider',
        },
      ],
      warnings: [],
      coverage: [],
      readinessBlockers: [],
    });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(result.response).toContain('fakecrmpro');
    // No replan, no build, no throw — one plan call total.
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(1);
    expect(builder.build).not.toHaveBeenCalled();
    // The question is persisted so the next turn carries it as pending context.
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        clarificationQuestion: expect.stringContaining('fakecrmpro'),
        intent: 'automation_design',
      }),
    );
  });

  it('completes with a credential message when the build is not ready to run', async () => {
    builder.build.mockResolvedValue({
      automation: {
        id: 'auto-1',
        status: 'ACTIVE',
        externalWorkflowId: 'wf-1',
        webhookPath: 'orders-auto',
        version: 1,
        buildable: true,
        readyToRun: false,
        readinessBlockers: [
          { nodeId: 'S1', integration: 'gmail', credentialStatus: 'NEEDS_CREDENTIAL' },
          { nodeId: 'S2', integration: 'slack', credentialStatus: 'NEEDS_CREDENTIAL' },
        ],
      },
      validation: { valid: true },
    });
    validator.validate.mockResolvedValue({
      ok: true,
      checks: [{ name: 'workflow_responded', passed: true }],
      durationMs: 5,
      testInput: { test: true },
    });

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.response).toContain("I've built");
    expect(resumed.response).toContain('Gmail');
    expect(resumed.response).toContain('Slack');
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('replans with static feedback instead of failing the run', async () => {
    builder.validateOnly
      .mockResolvedValueOnce({
        valid: false,
        errors: [{ code: 'INVALID_PLAN', message: 'Schedule triggers need config.every' }],
        warnings: [],
        coverage: [],
      })
      .mockResolvedValue({ valid: true, errors: [], warnings: [], coverage: [] });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
    const secondPrompt = vi.mocked(llmRuntime.generateObject).mock.calls[1]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(secondPrompt.messages.map((m) => m.content).join('\n')).toContain('STATIC validation');
  });

  it('walks PLANNING → STATIC_VALIDATION → replan → BUILDING without backward hops', async () => {
    builder.validateOnly
      .mockResolvedValueOnce({
        valid: false,
        errors: [{ code: 'INVALID_PLAN', message: 'Schedule triggers need config.every' }],
        warnings: [{ code: 'UNMAPPED_STEP', message: 'Prefer the native node' }],
        coverage: [],
      })
      .mockResolvedValue({ valid: true, errors: [], warnings: [], coverage: [] });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    const phases = agentRuns.advance.mock.calls.map((call) => call[1].toPhase).filter(Boolean);
    // BUILDING is entered once, after the passing validation — never before
    // the failed one, so no BUILDING → PLANNING hop exists.
    expect(phases).toEqual([
      AGENT_RUN_PHASE.PLANNING,
      AGENT_RUN_PHASE.PLANNING,
      AGENT_RUN_PHASE.STATIC_VALIDATION,
      AGENT_RUN_PHASE.BUILDING,
    ]);
  });

  it('persists validationResult before replanning a failed static check', async () => {
    builder.validateOnly
      .mockResolvedValueOnce({
        valid: false,
        errors: [{ code: 'INVALID_PLAN', message: 'Schedule triggers need config.every' }],
        warnings: [{ code: 'UNMAPPED_STEP', message: 'Prefer the native node' }],
        coverage: [{ requirementId: 'R1' }],
      })
      .mockResolvedValue({ valid: true, errors: [], warnings: [], coverage: [] });

    await service().run(input());

    expect(agentRuns.recordArtifacts).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        validationResult: expect.objectContaining({
          valid: false,
          errors: [{ code: 'INVALID_PLAN', message: 'Schedule triggers need config.every' }],
          warnings: [{ code: 'UNMAPPED_STEP', message: 'Prefer the native node' }],
          coverage: [{ requirementId: 'R1' }],
        }),
      }),
      'static validation failed',
    );
  });

  it('persists validationResult when the attempt budget is exhausted', async () => {
    builder.validateOnly.mockResolvedValue({
      valid: false,
      errors: [{ code: 'INVALID_PLAN', message: 'bad node' }],
      warnings: [],
      coverage: [],
    });

    await expect(service().run(input())).rejects.toThrow('static validation');
    expect(agentRuns.recordArtifacts).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ validationResult: expect.objectContaining({ valid: false }) }),
      'static validation failed',
    );
  });

  it('records understanding failure diagnostics without swallowing the error', async () => {
    understandingService.understand.mockRejectedValue(
      Object.assign(new Error('No object generated: empty [structured-output:EMPTY]'), {
        kind: 'EMPTY',
        details: { rawSample: '', finishReason: 'stop' },
      }),
    );

    await expect(service().run(input())).rejects.toThrow('No object generated');
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        understandingFailure: expect.objectContaining({ kind: 'EMPTY', finishReason: 'stop' }),
      }),
    );
  });

  it('replans a generic node pick into the native node after NATIVE_NODE_AVAILABLE', async () => {
    planReview.review
      .mockReturnValueOnce({
        blueprint,
        valid: false,
        errors: [
          {
            code: 'NATIVE_NODE_AVAILABLE',
            message:
              'Step "Notify" uses n8n-nodes-base.httpRequest but the connected n8n instance provides the native n8n-nodes-base.whatsApp — replace it',
          },
        ],
        warnings: [],
        coverage: [],
      })
      .mockReturnValue({ blueprint, valid: true, errors: [], warnings: [], coverage: [] });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
    const secondPrompt = vi.mocked(llmRuntime.generateObject).mock.calls[1]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(secondPrompt.messages.map((m) => m.content).join('\n')).toContain(
      'n8n-nodes-base.whatsApp',
    );
  });

  it('asks for missing requirements in human-readable form, never raw R-ids', async () => {
    planReview.review.mockReturnValue({
      blueprint: { ...blueprint, ready: false, missingRequirements: ['R2', 'R3'] },
      valid: true,
      errors: [],
      warnings: [],
      coverage: [],
    });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    // Internal ids are mapped to readable text, never shown as bare "- R2" lines.
    expect(result.response).toContain('Requirement R2');
    expect(result.response).not.toMatch(/^-\s*R2$/m);
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(1);
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('does not re-ask requirements the user already answered', async () => {
    // R1 was explicitly provided by the user (source user + value) — the
    // planner listing it as missing must not bounce back to the user.
    planReview.review.mockReturnValue({
      blueprint: { ...blueprint, ready: false, missingRequirements: ['R1'] },
      valid: true,
      errors: [],
      warnings: [],
      coverage: [],
      readinessBlockers: [],
    });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(result.response).toContain('Draft automation blueprint: Order sync');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(1);
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('saves the plan as a draft instead of failing when no n8n connection exists', async () => {
    n8nConnections.resolveActiveForScope.mockResolvedValue(null);

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('WAITING');
    expect(resumed.response).toContain('saved it as a draft');
    expect(resumed.response).toContain('no n8n instance is connected');
    expect(builder.build).not.toHaveBeenCalled();
    expect(agentRuns.recordArtifacts).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ automationPlan: expect.anything() }),
      expect.stringContaining('draft'),
    );
  });

  it('provisions a deferred draft without replanning once n8n is connected', async () => {
    agentRuns.snapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'WAITING',
        currentPhase: AGENT_RUN_PHASE.STATIC_VALIDATION,
        metadata: {
          automationV2: true,
          buildDeferred: true,
          userMessage: 'Sync my orders',
        },
        automationPlan: blueprint,
        requirements: [{ id: 'R1', field: 'sync', required: true }],
        conditions: [],
      },
      transitions: [],
    });

    const result = await service().provisionDeferred('run-1', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    expect(result.response).toContain('ACTIVE');
    expect(builder.build).toHaveBeenCalledTimes(1);
    // No replan: the stored blueprint is provisioned directly.
    expect(llmRuntime.generateObject).not.toHaveBeenCalled();
  });

  it('keeps the draft waiting when n8n is still not connected', async () => {
    n8nConnections.resolveActiveForScope.mockResolvedValue(null);
    agentRuns.snapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'WAITING',
        currentPhase: AGENT_RUN_PHASE.STATIC_VALIDATION,
        metadata: { automationV2: true, buildDeferred: true },
        automationPlan: blueprint,
      },
      transitions: [],
    });

    const result = await service().provisionDeferred('run-1', { userId: 'user-1' });

    expect(result.status).toBe('WAITING');
    expect(result.response).toContain('still no ACTIVE n8n connection');
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('renders the design summary while waiting for approval', async () => {
    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(result.response).toContain('Draft automation blueprint: Order sync');
    expect(result.response).toContain('Goal: Sync orders');
    expect(conversations.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ role: 'assistant' }),
    );
  });

  it('replans placeholder integration names instead of asking to connect them', async () => {
    planReview.review
      .mockReturnValueOnce({
        blueprint,
        valid: false,
        errors: [
          { code: 'UNKNOWN_INTEGRATION', message: 'Integration "PENDING" is not connected' },
        ],
        warnings: [],
        coverage: [],
      })
      .mockReturnValue({ blueprint, valid: true, errors: [], warnings: [], coverage: [] });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
    const secondPrompt = vi.mocked(llmRuntime.generateObject).mock.calls[1]?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(secondPrompt.messages.map((m) => m.content).join('\n')).toContain('PENDING');
  });

  it('rejects resume from the wrong scope', async () => {
    const result = await service().resume('run-1', { approved: true }, { userId: 'intruder' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('user scope');
  });

  it('repairs a failing test execution and completes', async () => {
    validator.validate
      .mockResolvedValueOnce({
        ok: false,
        checks: [{ name: 'output_contract', passed: false, detail: 'missing orderId' }],
        durationMs: 5,
        testInput: { test: true },
        classified: {
          code: 'LOGIC_ERROR',
          retryable: false,
          repairStrategy: 'replan_step',
          summary: 'Output mismatch.',
        },
      })
      .mockResolvedValue({
        ok: true,
        checks: [{ name: 'workflow_responded', passed: true }],
        durationMs: 5,
        testInput: { test: true },
      });

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.response).toContain('after 1 automatic repair');
    // Initial provision + one repair reprovision on the same row.
    expect(builder.build).toHaveBeenCalledTimes(2);
    expect(builder.build).toHaveBeenLastCalledWith(
      expect.objectContaining({ automationId: 'auto-1' }),
    );
    expect(agentRuns.appendRepairAttempt).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it('escalates with the §42 message after exhausting the repair budget', async () => {
    validator.validate.mockResolvedValue({
      ok: false,
      checks: [{ name: 'workflow_responded', passed: false, detail: 'boom' }],
      durationMs: 5,
      testInput: { test: true },
      classified: {
        code: 'API_ERROR',
        retryable: true,
        repairStrategy: 'retry_execution',
        summary: 'Instance errored.',
      },
    });
    // Transient strategy → unchanged retries, still bounded by the budget.
    repair.needsPatch.mockReturnValue(false);

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('FAILED');
    expect(resumed.response).toBe('Escalation message');
    expect(repair.escalationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ automationName: 'Order sync' }),
    );
    expect(agentRuns.advance).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ toPhase: 'FAILED', toStatus: 'FAILED' }),
    );
  });

  it('retryFromFailure re-enters at diagnose without rebuilding', async () => {
    agentRuns.isRepairable.mockResolvedValue(true);
    agentRuns.snapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'FAILED',
        currentPhase: 'FAILED',
        error: 'Output mismatch',
        metadata: { automationV2: true, userMessage: 'Sync my orders' },
        automationPlan: blueprint,
        requirements: [{ id: 'R1', field: 'sync', required: true }],
        conditions: [],
        executionResults: {
          automationId: 'auto-1',
          externalWorkflowId: 'wf-1',
          webhookPath: 'orders-auto',
        },
        repairAttempts: [],
      },
      transitions: [],
    });

    const result = await service().retryFromFailure('run-1', { userId: 'user-1' });

    expect(result.status).toBe('COMPLETED');
    // No re-understanding, no re-planning — straight to diagnose → repair → test.
    expect(understandingService.understand).not.toHaveBeenCalled();
    expect(llmRuntime.generateObject).not.toHaveBeenCalled();
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(builder.build).toHaveBeenCalledWith(expect.objectContaining({ automationId: 'auto-1' }));
  });

  it('retryFromFailure refuses runs that are not repairable', async () => {
    agentRuns.isRepairable.mockResolvedValue(false);

    const result = await service().retryFromFailure('run-1', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('cannot be retried');
    expect(builder.build).not.toHaveBeenCalled();
  });
});
