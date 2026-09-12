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
  const conversations = {
    addMessage: vi.fn(),
    titleFromFirstMessage: vi.fn(),
    getMessages: vi.fn(),
  };
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
    conversations.getMessages.mockResolvedValue([]);
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
    expect(conversations.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ role: 'user', content: 'Sync my orders' }),
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

  it('fails gracefully with the real reason after a second review rejection', async () => {
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

    const result = await service().run(input());

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain("couldn't finalize the automation design");
    expect(result.response).toContain('failed review twice');
    expect(result.response).toContain('Nothing was provisioned');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
  });

  it('fails verifiably when static validation rejects the plan', async () => {
    builder.validateOnly.mockResolvedValue({
      valid: false,
      errors: [{ code: 'INVALID_PLAN', message: 'bad node' }],
      warnings: [],
      coverage: [],
    });

    const result = await service().run(input());

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain("couldn't finalize the automation design");
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
    // The gate emits the client-renderable approval event BEFORE the wait.
    const approvalIndex = events.findIndex((e) => e.type === 'approval.required');
    expect(approvalIndex).toBeGreaterThan(-1);
    expect(events[approvalIndex]).toMatchObject({
      runId: 'run-1',
      reason: 'automation_design_approval',
    });
    expect(events.at(-1)).toMatchObject({ type: 'run.waiting', reason: 'approval' });
    expect(events.findIndex((e) => e.type === 'run.waiting')).toBeGreaterThan(approvalIndex);
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

    const result = await service().run(input());

    expect(result.status).toBe('FAILED');
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

    const result = await service().run(input());

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('No object generated');
    expect(result.response).toContain('Nothing was provisioned');
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        understandingFailure: expect.objectContaining({ kind: 'EMPTY', finishReason: 'stop' }),
      }),
    );
  });

  it('self-corrects a failed blueprint generation at high effort instead of failing', async () => {
    llmRuntime.generateObject
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'No object generated: the model did not return a response. [structured-output:SCHEMA_INVALID]',
          ),
          {
            kind: 'SCHEMA_INVALID',
            details: { rawSample: '{bad', finishReason: 'stop' },
          },
        ),
      )
      .mockResolvedValue({
        object: blueprint,
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      });

    const result = await service().run(input());

    expect(result.status).toBe('WAITING');
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
    expect(llmRuntime.generateObject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mode: 'medium', maxTokens: 4000 }),
    );
    const corrective = vi.mocked(llmRuntime.generateObject).mock.calls[1]?.[0] as {
      mode: string;
      maxTokens: number;
      timeoutMs: number;
      messages: Array<{ content: string }>;
    };
    expect(corrective.mode).toBe('high');
    expect(corrective.maxTokens).toBe(6000);
    const correctivePrompt = corrective.messages.map((m) => m.content).join('\n');
    expect(correctivePrompt).toContain('prior_failure');
    expect(correctivePrompt).toContain('SCHEMA_INVALID');
  });

  it('records plan failure diagnostics and humanizes truncation when correction fails', async () => {
    llmRuntime.generateObject.mockRejectedValue(
      Object.assign(new Error('No object generated: empty [structured-output:EMPTY]'), {
        kind: 'EMPTY',
        details: { rawSample: '', finishReason: 'length' },
      }),
    );

    const result = await service().run(input());

    expect(result.status).toBe('FAILED');
    // First attempt + exactly one corrective pass — never an open loop.
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
    expect(result.response).toContain('too large for one response');
    expect(result.response).toContain('Nothing was provisioned');
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        planFailure: expect.objectContaining({
          kind: 'EMPTY',
          finishReason: 'length',
          truncated: true,
        }),
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

  it('does not re-ask a requirement answered in an earlier turn', async () => {
    // Live regression: the user answered "slack dm" one turn ago; the NEXT
    // turn's replan listed R1 as missing again and the reply-only filter
    // re-asked it because the new reply didn't repeat the value.
    understandingService.understand.mockResolvedValue({
      ...understanding,
      requirements: [
        { id: 'R1', field: 'destination', value: 'slack dm', required: true, source: 'history' },
      ],
    });
    planReview.review.mockReturnValue({
      blueprint: { ...blueprint, ready: false, missingRequirements: ['R1'] },
      valid: true,
      errors: [],
      warnings: [],
      coverage: [],
      readinessBlockers: [],
    });
    conversations.getMessages.mockResolvedValue([
      { role: 'user', content: 'slack dm' },
      { role: 'assistant', content: 'Which channel should I post to?' },
    ]);

    const result = await service().run(input({ userMessage: 'start build the flow' }));

    expect(conversations.getMessages).toHaveBeenCalledWith(
      'conv-1',
      { take: 20, order: 'desc' },
      { userId: 'user-1', organizationId: 'org-1' },
    );
    // Answered in history → filtered → design proceeds to the approval gate.
    expect(result.status).toBe('WAITING');
    expect(result.response).toContain('Draft automation blueprint: Order sync');
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
      expect.objectContaining({ role: 'user', content: 'Sync my orders' }),
    );
    // The approval gate is stamped on the run row so a later chat verdict
    // ("ok i approve") can route to resume() instead of a fresh design.
    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        approvalPending: true,
        approvalGate: 'design_approval',
        approvalSummary: expect.stringContaining('Draft automation blueprint'),
      }),
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

  it('stamps the rejection and refuses to retry it — no approval-gate bypass', async () => {
    const svc = service();
    await svc.run(input());
    await svc.resume('run-1', { approved: false, reason: 'Too risky' });

    expect(runs.updateMetadata).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ approvalDecision: 'rejected', rejectionReason: 'Too risky' }),
    );

    // A rejected run is FAILED + phase FAILED — exactly what isRepairable
    // accepts. Without the rejection stamp, retryFromFailure would hydrate
    // the rejected blueprint and provision it.
    agentRuns.isRepairable.mockResolvedValue(true);
    agentRuns.snapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'FAILED',
        currentPhase: 'FAILED',
        error: 'automation rejected at approval gate',
        metadata: {
          automationV2: true,
          approvalDecision: 'rejected',
          rejectedAt: '2026-09-11T00:00:00.000Z',
          userMessage: 'Sync my orders',
        },
        automationPlan: blueprint,
        requirements: [],
        conditions: [],
        executionResults: {},
        repairAttempts: [],
      },
      transitions: [],
    });

    const result = await service().retryFromFailure('run-1', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('rejected this automation design');
    expect(builder.build).not.toHaveBeenCalled();
  });

  it('escalates credential failures immediately instead of burning the repair budget', async () => {
    clientApi.getWorkflow.mockRejectedValue(new Error('invalid credentials'));
    classifier.classify.mockReturnValue({
      code: 'CREDENTIAL_ERROR',
      retryable: false,
      repairStrategy: 'fix_credentials',
      summary: 'Authentication with n8n failed during verify.',
      userAction: 'Reconnect the n8n instance.',
    });
    repair.needsPatch.mockReturnValue(false);
    repair.escalationMessage.mockReturnValue('Reconnect the n8n instance and retry.');

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('FAILED');
    expect(resumed.response).toBe('Reconnect the n8n instance and retry.');
    // Provisioned once, then straight to escalation — no futile patch loop.
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(repair.diagnoseAndPatch).not.toHaveBeenCalled();
    expect(agentRuns.appendRepairAttempt).not.toHaveBeenCalled();
  });

  it('provisions the final (MAX) repair patch instead of discarding it', async () => {
    validator.validate.mockResolvedValue({
      ok: false,
      checks: [{ name: 'workflow_responded', passed: false, detail: 'boom' }],
      durationMs: 5,
      testInput: { test: true },
      classified: {
        code: 'LOGIC_ERROR',
        retryable: false,
        repairStrategy: 'replan_step',
        summary: 'Broken output.',
      },
    });

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('FAILED');
    // Initial provision + all MAX_REPAIR_ATTEMPTS patches reach provisioning.
    expect(builder.build).toHaveBeenCalledTimes(1 + 3);
    expect(agentRuns.appendRepairAttempt).toHaveBeenCalledTimes(3);
  });

  it('loops a failed repair revalidation back to diagnosis instead of provisioning it', async () => {
    validator.validate.mockResolvedValue({
      ok: false,
      checks: [{ name: 'workflow_responded', passed: false, detail: 'boom' }],
      durationMs: 5,
      testInput: { test: true },
      classified: {
        code: 'LOGIC_ERROR',
        retryable: false,
        repairStrategy: 'replan_step',
        summary: 'Broken output.',
      },
    });
    // The initial static validation passes; every post-patch revalidation fails.
    builder.validateOnly
      .mockResolvedValueOnce({ valid: true, errors: [], warnings: [], coverage: [] })
      .mockResolvedValue({
        valid: false,
        errors: [{ code: 'INVALID_PLAN', message: 'patched plan is broken' }],
        warnings: [],
        coverage: [],
      });

    const svc = service();
    await svc.run(input());
    const resumed = await svc.resume('run-1', { approved: true }, { userId: 'user-1' });

    expect(resumed.status).toBe('FAILED');
    // The known-invalid patched blueprints never reach provisioning.
    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(agentRuns.appendRepairAttempt).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ stage: 'validate', code: 'INVALID_CONFIGURATION' }),
    );
  });

  it('re-validates a deferred draft against the newly connected instance', async () => {
    agentRuns.snapshot.mockResolvedValue({
      run: {
        id: 'run-1',
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'WAITING',
        currentPhase: AGENT_RUN_PHASE.STATIC_VALIDATION,
        metadata: { automationV2: true, buildDeferred: true, userMessage: 'Sync my orders' },
        automationPlan: blueprint,
        requirements: [{ id: 'R1', field: 'sync', required: true }],
        conditions: [],
      },
      transitions: [],
    });
    builder.validateOnly.mockResolvedValue({
      valid: false,
      errors: [
        { code: 'NODE_NOT_FOUND', message: 'n8n-nodes-base.customCrm is not on this instance' },
      ],
      warnings: [],
      coverage: [],
    });

    const result = await service().provisionDeferred('run-1', { userId: 'user-1' });

    expect(result.status).toBe('FAILED');
    expect(result.response).toContain('no longer validates');
    // The invalid-for-this-instance plan never reaches provisioning.
    expect(builder.build).not.toHaveBeenCalled();
  });
});
