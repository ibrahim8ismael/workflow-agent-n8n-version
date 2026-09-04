import { describe, expect, it, vi } from 'vitest';
import type { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import type { AgentsService } from '../../agents/services/agents.service';
import type { ChannelsService } from '../../channels/services/channels.service';
import type { IntegrationsService } from '../../integrations/services/integrations.service';
import type { KnowledgeService } from '../../knowledge/services/knowledge.service';
import type { MemoryService } from '../../memory/services/memory.service';
import type { JsonValue } from '../interfaces/tool.interface';
import { JaafarApprovalService } from './jaafar-approval.service';
import type { JaafarIdempotencyService } from './jaafar-idempotency.service';
import type { ToolAuditService } from './tool-audit.service';
import { ToolExecutorService } from './tool-executor.service';
import type { ToolPermissionService } from './tool-permission.service';

const tool = (overrides: Record<string, unknown> = {}) => ({
  id: 'search_tool',
  name: 'Search tool',
  slug: 'search_tool',
  description: 'Searches information',
  executionMode: 'ai' as const,
  inputSchema: { type: 'object', required: ['query'] },
  outputSchema: { type: 'string' },
  requiredPermissions: [],
  requiredIntegrations: [],
  requiresApproval: false,
  sideEffect: false,
  timeoutMs: 100,
  maxRetries: 0,
  retryPolicy: { maxAttempts: 1, retryableCodes: [] },
  idempotent: false,
  successCriteria: [],
  permissionScope: 'user_or_organization',
  ...overrides,
});

const request = (input: Record<string, unknown> = { query: 'find this' }) => ({
  runId: 'run-1',
  agentId: 'agent-1',
  userMessage: 'Find this',
  input: input as JsonValue,
  userId: 'user-1',
  organizationId: 'org-1',
});

describe('ToolExecutorService', () => {
  const setup = (overrides?: {
    approval?: Partial<JaafarApprovalService>;
    idempotency?: Partial<JaafarIdempotencyService>;
    llm?: Partial<LLMRuntimeService>;
    knowledge?: Partial<KnowledgeService>;
    memory?: Partial<MemoryService>;
    permission?: Partial<ToolPermissionService>;
    audit?: Partial<ToolAuditService>;
    agents?: Partial<AgentsService>;
    integrations?: Partial<IntegrationsService>;
    channels?: Partial<ChannelsService>;
  }) => {
    const knowledge = {
      search: vi.fn().mockResolvedValue([]),
      ...overrides?.knowledge,
    } as unknown as KnowledgeService;
    const memory = {
      searchByAgent: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
      ...overrides?.memory,
    } as unknown as MemoryService;
    const llm = {
      generateText: vi.fn().mockResolvedValue({ content: 'result' }),
      ...overrides?.llm,
    } as unknown as LLMRuntimeService;
    const approval = {
      evaluate: vi.fn().mockReturnValue({
        tool: tool(),
        requirement: { required: false },
        readOnly: false,
      }),
      assertExecutionAllowed: vi.fn(),
      ...overrides?.approval,
    } as unknown as JaafarApprovalService;
    const idempotency = {
      begin: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      markUnknown: vi.fn(),
      ...overrides?.idempotency,
    } as unknown as JaafarIdempotencyService;
    const permission = overrides?.permission as ToolPermissionService | undefined;
    const audit = overrides?.audit as ToolAuditService | undefined;
    const agents = overrides?.agents as AgentsService | undefined;
    const integrations = overrides?.integrations as IntegrationsService | undefined;
    const channels = overrides?.channels as ChannelsService | undefined;

    return {
      service: new ToolExecutorService(
        knowledge,
        memory,
        llm,
        approval,
        idempotency,
        permission,
        audit,
        agents,
        integrations,
        channels,
      ),
      knowledge,
      memory,
      llm,
      approval,
      idempotency,
    };
  };

  it('rejects invalid input before execution', async () => {
    const { service, llm, idempotency } = setup();

    const result = await service.execute(tool(), request({}));

    expect(result).toMatchObject({
      success: false,
      error: { code: 'INVALID_TOOL_INPUT', retryable: false },
    });
    expect(llm.generateText).not.toHaveBeenCalled();
    expect(idempotency.begin).not.toHaveBeenCalled();
  });

  it('checks approval before creating an idempotency record', async () => {
    const approval = {
      evaluate: vi.fn().mockReturnValue({
        tool: tool({ sideEffect: true, requiresApproval: true }),
        requirement: { required: true, reason: 'Needs approval' },
        readOnly: false,
      }),
      assertExecutionAllowed: vi.fn().mockImplementation(() => {
        throw new Error('approval required');
      }),
    };
    const { service, idempotency } = setup({ approval });

    const result = await service.execute(tool({ sideEffect: true }), request());

    expect(result.error?.message).toBe('approval required');
    expect(idempotency.begin).not.toHaveBeenCalled();
  });

  it('executes knowledge tools through the knowledge service', async () => {
    const { service, knowledge } = setup({
      knowledge: { search: vi.fn().mockResolvedValue([{ content: 'answer' }]) },
    });

    const result = await service.execute(
      tool({ executionMode: 'knowledge', outputSchema: { type: 'array' } }),
      request({ query: 'company policy', limit: 3 }),
    );

    expect(result.success).toBe(true);
    expect(knowledge.search).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      query: 'company policy',
      category: undefined,
      limit: 3,
      offset: 0,
    });
  });

  it('retries retryable model failures within the tool limit', async () => {
    const generateText = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ content: 'recovered' });
    const { service, llm } = setup({ llm: { generateText } });

    const result = await service.execute(tool({ maxRetries: 1 }), request());

    expect(result).toMatchObject({ success: true, output: 'recovered' });
    expect(llm.generateText).toHaveBeenCalledTimes(2);
  });

  it('returns a completed idempotent result without executing the side effect', async () => {
    const idempotency = {
      begin: vi.fn().mockResolvedValue({
        key: 'run-1:send_tool:send',
        status: 'COMPLETED',
        result: { sent: true },
      }),
    };
    const { service, llm } = setup({ idempotency });

    const result = await service.execute(
      tool({ id: 'send_tool', name: 'Send', sideEffect: true, outputSchema: { type: 'object' } }),
      { ...request({ query: 'send', message: 'hello' }), logicalAction: 'send' },
    );

    expect(result).toMatchObject({ success: true, output: { sent: true } });
    expect(llm.generateText).not.toHaveBeenCalled();
  });

  it('blocks execution when the permission boundary denies the tool', async () => {
    const permission = {
      assertAllowed: vi.fn().mockImplementation(() => {
        throw new Error('missing capability');
      }),
    };
    const { service, llm } = setup({ permission });

    const result = await service.execute(tool({ requiredPermissions: ['tool:send'] }), request());

    expect(result).toMatchObject({
      success: false,
      error: { code: 'UNKNOWN_RUNTIME_FAILURE' },
    });
    expect(permission.assertAllowed).toHaveBeenCalled();
    expect(llm.generateText).not.toHaveBeenCalled();
  });

  it('emits redacted structured audit lifecycle events', async () => {
    const audit = { record: vi.fn() };
    const { service } = setup({ audit });

    await service.execute(tool(), request({ query: 'sensitive input' }));

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.started', runId: 'run-1', toolId: 'search_tool' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.completed', runId: 'run-1', toolId: 'search_tool' }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('sensitive input');
  });

  it('executes employee reads through scoped domain services', async () => {
    const agents = {
      findById: vi.fn().mockResolvedValue({
        id: 'employee-1',
        name: 'Support',
        status: 'DRAFT',
        organizationId: 'org-1',
      }),
    };
    const { service } = setup({ agents });

    const result = await service.execute(
      tool({
        id: 'employee_get',
        executionMode: 'domain',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      }),
      request({ employeeId: 'employee-1' }),
    );

    expect(result).toMatchObject({ success: true, output: { id: 'employee-1', name: 'Support' } });
    expect(agents.findById).toHaveBeenCalledWith('employee-1', false, {
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  it('returns scoped integration and channel readiness without exposing credentials', async () => {
    const integrations = { isConnected: vi.fn().mockResolvedValue(true) };
    const channels = { isAvailable: vi.fn().mockResolvedValue(false) };
    const { service } = setup({ integrations, channels });

    const result = await service.execute(
      tool({
        id: 'integration_status',
        executionMode: 'domain',
        inputSchema: { type: 'object', required: ['integration'] },
        outputSchema: { type: 'object' },
      }),
      request({ integration: 'slack' }),
    );

    expect(result).toMatchObject({
      success: true,
      output: { integration: 'slack', integrationReady: true, channelReady: false, ready: true },
    });
    expect(integrations.isConnected).toHaveBeenCalledWith('org-1', 'slack');
    expect(channels.isAvailable).toHaveBeenCalledWith('agent-1', 'slack');
    expect(JSON.stringify(result)).not.toContain('token');
  });

  // --- Characterization tests (PLAN Step 0): lock the n8n tool path before client-n8n refactor ---

  it('routes n8n-mode tools through the workflow executor with slug, input and stable idempotency key', async () => {
    const n8n = {
      execute: vi.fn().mockResolvedValue({ customerId: 'cust_1' }),
    };
    const { service, llm } = setup();
    (service as unknown as { n8n: unknown }).n8n = n8n;

    const result = await service.execute(
      tool({
        id: 'crm_lookup',
        slug: 'search_customer',
        executionMode: 'n8n' as const,
        inputSchema: { type: 'object', required: ['query'] },
        outputSchema: { type: 'object' },
      }),
      request(),
    );

    expect(result).toMatchObject({ success: true, output: { customerId: 'cust_1' } });
    expect(n8n.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'search_customer',
        input: { query: 'find this' },
        userId: 'user-1',
        organizationId: 'org-1',
        idempotencyKey: 'run-1:crm_lookup',
      }),
    );
    expect(llm.generateText).not.toHaveBeenCalled();
  });

  it('surfaces n8n executor failures as failed tool results without retrying non-retryable errors', async () => {
    const { N8nWorkflowError } = await import(
      '../../../infrastructure/n8n/n8n-workflow-executor.service'
    );
    const n8n = {
      execute: vi.fn().mockRejectedValue(new N8nWorkflowError('workflow returned HTTP 400', false)),
    };
    const { service } = setup();
    (service as unknown as { n8n: unknown }).n8n = n8n;

    const result = await service.execute(
      tool({
        id: 'crm_lookup',
        executionMode: 'n8n' as const,
        maxRetries: 3,
      }),
      request(),
    );

    expect(result.success).toBe(false);
    expect(n8n.execute).toHaveBeenCalledTimes(1);
  });

  it('passes the automation binding through to the executor (PLAN Step 10)', async () => {
    const n8n = {
      execute: vi.fn().mockResolvedValue({ synced: true }),
    };
    const { service } = setup();
    (service as unknown as { n8n: unknown }).n8n = n8n;

    const result = await service.execute(
      tool({
        id: 'invoice-sync-b7e2c1aa',
        slug: 'invoice-sync-b7e2c1aa',
        executionMode: 'n8n' as const,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        binding: { baseUrl: 'https://client.example.com', webhookPath: 'invoice-sync-b7e2c1aa' },
      }),
      request(),
    );

    expect(result).toMatchObject({ success: true, output: { synced: true } });
    expect(n8n.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: { baseUrl: 'https://client.example.com', webhookPath: 'invoice-sync-b7e2c1aa' },
      }),
    );
  });

  it('returns INTEGRATION_UNAVAILABLE without executing when the automation connection is unusable', async () => {
    const n8n = { execute: vi.fn() };
    const { service } = setup();
    (service as unknown as { n8n: unknown }).n8n = n8n;

    const result = await service.execute(
      tool({
        id: 'invoice-sync-b7e2c1aa',
        executionMode: 'n8n' as const,
        unavailableReason: 'INTEGRATION_UNAVAILABLE' as const,
      }),
      request(),
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'INTEGRATION_UNAVAILABLE', retryable: false },
    });
    expect(n8n.execute).not.toHaveBeenCalled();
  });
});
