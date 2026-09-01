import { describe, expect, it, vi, vi as viCore } from 'vitest';

// SSRF guard must not hit real DNS in tests — resolve to a public IP.
vi.mock('node:dns/promises', () => ({
  lookup: viCore.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

import { AutomationsRepository } from '../../modules/automations/repositories/automations.repository';
import { AutomationsService } from '../../modules/automations/services/automations.service';
import { N8nConnectionsRepository } from '../../modules/integrations/n8n/repositories/n8n-connections.repository';
import { N8nConnectionsService } from '../../modules/integrations/n8n/services/n8n-connections.service';
import { AutomationDesignSessionService } from '../../modules/runtime/services/automation-design-session.service';
import { AutomationToolResolverService } from '../../modules/runtime/services/automation-tool-resolver.service';
import { ContextBuilderService } from '../../modules/runtime/services/context-builder.service';
import { JaafarAutomationDesignGraphService } from '../../modules/runtime/services/jaafar-automation-design-graph.service';
import { JaafarContextLoaderService } from '../../modules/runtime/services/jaafar-context-loader.service';
import { ToolExecutorService } from '../../modules/runtime/services/tool-executor.service';
import { SecretBoxService } from '../crypto/secret-box.service';
import { LLMRuntimeService } from '../llm-runtime/llm-runtime.service';
import { N8nClientApiService } from './n8n-client-api.service';
import { N8nProvisionerService } from './n8n-provisioner.service';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

const ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const INTER_SERVICE_SECRET = 'woops-test-secret-123456';
const CLIENT_BASE = 'https://n8n.client.example.com';
const WEBHOOK_PATH = 'invoice-sync-auto-1';

describe('MVP Vertical Slice (client-managed n8n, PLAN Step 12)', () => {
  it('connects n8n → designs via Jaafar → approves → provisions → executes via the client webhook', async () => {
    // ── Shared mock n8n REST + webhook receiver ─────────────────────────
    const provisionedWorkflows = new Map<string, unknown>();
    let receivedHeaders: Record<string, string> | undefined;
    let receivedBody: unknown;

    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.href;
        const headers = (init?.headers ?? {}) as Record<string, string>;

        // Client n8n REST API (provisioning / verification)
        if (url === `${CLIENT_BASE}/api/v1/workflows?limit=1`) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ data: [] }),
          };
        }
        if (url === `${CLIENT_BASE}/api/v1/workflows` && init?.method === 'POST') {
          expect(headers['X-N8N-API-KEY']).toBeTruthy();
          const payload = JSON.parse(init.body as string) as { name: string; nodes: unknown[] };
          const created = { id: 'wf-1', name: payload.name, active: false, nodes: payload.nodes };
          provisionedWorkflows.set('wf-1', created);
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => created,
          };
        }
        if (url === `${CLIENT_BASE}/api/v1/workflows/wf-1/activate`) {
          const wf = provisionedWorkflows.get('wf-1') as { active: boolean } | undefined;
          if (wf) wf.active = true;
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({}),
          };
        }
        if (url === `${CLIENT_BASE}/api/v1/workflows/wf-1`) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              ...(provisionedWorkflows.get('wf-1') as object),
              nodes: [...(provisionedWorkflows.get('wf-1') as { nodes: unknown[] }).nodes],
            }),
          };
        }

        // Client n8n production webhook (automation execution)
        if (url === `${CLIENT_BASE}/webhook/${WEBHOOK_PATH}`) {
          receivedHeaders = headers;
          receivedBody = JSON.parse(init?.body as string);
          return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({
              success: true,
              data: { invoiceId: 'inv-1', ledgerId: 'led_991' },
            }),
          };
        }

        return {
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          json: async () => ({}),
        };
      });
    vi.stubGlobal('fetch', fetchMock);

    const baseConfig = {
      get: vi.fn((key: string) => {
        if (key === 'CREDENTIAL_ENCRYPTION_KEY') return ENCRYPTION_KEY;
        if (key === 'WOOPS_INTER_SERVICE_SECRET') return INTER_SERVICE_SECRET;
        if (key === 'N8N_TIMEOUT_MS') return 2000;
        if (key === 'N8N_MAX_RETRIES') return 0;
        return undefined;
      }),
    };

    // ── 1. Client connects their n8n (API key encrypted at rest, verified) ──
    const secretBox = new SecretBoxService(baseConfig as never);
    secretBox.onModuleInit();

    const connectionRows = new Map<string, Record<string, unknown>>();
    const connectionCreds = new Map<string, string>();
    const connectionsRepo = {
      async create(data: Record<string, unknown>) {
        const row = {
          id: 'conn-1',
          status: 'PENDING_VERIFICATION',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        connectionRows.set(row.id as string, row);
        return row;
      },
      async findById(id: string) {
        return connectionRows.get(id) ?? null;
      },
      async list() {
        return [...connectionRows.values()];
      },
      async update(id: string, data: Record<string, unknown>) {
        const row = { ...connectionRows.get(id), ...data };
        connectionRows.set(id, row);
        return row;
      },
      async softDelete(id: string) {
        return connectionsRepo.update(id, { deletedAt: new Date() });
      },
      async upsertCredential(connectionId: string, encryptedData: string) {
        connectionCreds.set(connectionId, encryptedData);
        return {};
      },
      async getCredential(connectionId: string) {
        return connectionCreds.has(connectionId)
          ? { connectionId, encryptedData: connectionCreds.get(connectionId) }
          : null;
      },
    } as unknown as N8nConnectionsRepository;

    const clientApi = new N8nClientApiService(baseConfig as never);
    const connections = new N8nConnectionsService(connectionsRepo, secretBox, clientApi);

    const connection = await connections.create(
      { name: 'Client n8n', baseUrl: `${CLIENT_BASE}/`, apiKey: 'sk-client-api-key-9876' },
      { userId: 'user-1' },
    );
    expect(connection.status).toBe('ACTIVE');

    // ── 2. Jaafar designs an automation (mock LLM, real graph + session) ──
    const run = {
      id: 'run-1',
      agentId: 'agent-1',
      userId: 'user-1',
      status: 'CREATED',
      metadata: {} as Record<string, unknown>,
    };
    const runs = {
      create: vi.fn().mockResolvedValue(run),
      findById: vi.fn().mockImplementation(async () => run),
      transitionStatus: vi.fn().mockImplementation(async (_id: string, status: string) => {
        run.status = status;
        return run;
      }),
      updateMetadata: vi
        .fn()
        .mockImplementation(async (_id: string, metadata: Record<string, unknown>) => {
          run.metadata = { ...run.metadata, ...metadata };
          return run;
        }),
      recordModelUsage: vi.fn().mockResolvedValue(run),
      updateUsage: vi.fn().mockResolvedValue(run),
      complete: vi.fn().mockResolvedValue(run),
      fail: vi.fn().mockResolvedValue(run),
    };
    const conversations = {
      findByIdInScope: vi.fn().mockResolvedValue({ metadata: null }),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
      addMessage: vi.fn().mockResolvedValue(undefined),
      titleFromFirstMessage: vi.fn().mockResolvedValue(undefined),
    };
    const contextLoader = {
      load: vi.fn().mockResolvedValue({
        agent: { id: 'agent-1', name: 'Jaafar' },
        history: [],
        tools: [],
        memoryReferences: [],
        knowledgeReferences: [],
        readiness: [],
      }),
    };
    const contextBuilder = {
      build: vi.fn().mockResolvedValue({
        system: 'design prompt',
        messages: [{ role: 'user', content: 'Design an invoice sync automation' }],
      }),
    };
    const blueprint = {
      ready: true,
      missingRequirements: [],
      name: 'Invoice sync',
      goal: 'Sync paid invoices into the ledger',
      summary: 'Fetches paid invoices daily and records them.',
      description: 'Daily invoice ledger sync',
      trigger: { type: 'webhook' as const, config: {} },
      steps: [
        {
          name: 'Fetch invoices',
          action: 'Fetch paid invoices',
          integration: 'stripe',
          config: {},
        },
      ],
      integrations: ['stripe'],
      inputContract: { type: 'object', required: ['invoiceId'] },
      outputContract: { type: 'object' },
      riskNotes: [],
    };
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({
        object: blueprint,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        execution: { estimatedCost: 0 },
      }),
    };
    const automationRows = new Map<string, Record<string, unknown>>();
    const automationsRepo = {
      async create(data: Record<string, unknown>) {
        const nested = data.connection as { connect?: { id?: string } } | undefined;
        const connectionId = (nested?.connect?.id ?? data.connectionId) as string;
        const row = {
          id: 'auto-1',
          status: 'DESIGN',
          deletedAt: null,
          externalWorkflowId: null,
          webhookPath: null,
          lastSyncedAt: null,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          connectionId,
        };
        delete (row as Record<string, unknown>).connection;
        automationRows.set(row.id as string, row);
        return row;
      },
      async findById(id: string) {
        return automationRows.get(id) ?? null;
      },
      async list() {
        return [...automationRows.values()];
      },
      async update(id: string, data: Record<string, unknown>) {
        const row = { ...automationRows.get(id), ...data };
        automationRows.set(id, row);
        return row;
      },
      async softDelete(id: string) {
        return automationsRepo.update(id, { deletedAt: new Date() });
      },
      async findActiveConnectionId() {
        return 'conn-1';
      },
      async listActiveWithConnection() {
        return [...automationRows.values()]
          .filter((row) => row.status === 'ACTIVE')
          .map((row) => ({
            ...row,
            connection: connectionRows.get(row.connectionId as string) ?? null,
          }));
      },
    } as unknown as AutomationsRepository;

    const provisioner = new N8nProvisionerService(clientApi);
    const automations = new AutomationsService(automationsRepo, provisioner, connections);

    const sessionService = new AutomationDesignSessionService(
      conversations as never,
      runs as never,
    );
    const designGraph = new JaafarAutomationDesignGraphService(
      runs as never,
      conversations as never,
      contextLoader as unknown as JaafarContextLoaderService,
      contextBuilder as unknown as ContextBuilderService,
      sessionService,
      llmRuntime as unknown as LLMRuntimeService,
      automations,
    );

    const designInput = {
      runId: run.id,
      agentId: 'agent-1',
      userMessage: 'Design an invoice sync automation',
      userId: 'user-1',
      effort: 'low' as const,
    };
    const designResult = (await designGraph
      .build()
      .invoke(
        { input: designInput },
        designGraph.graphConfig(run.id, { userId: 'user-1' }),
      )) as Record<string, unknown>;
    expect(designResult.__interrupt__).toBeTruthy(); // approval gate
    expect(run.metadata.automationDesign).toMatchObject({
      status: 'READY_FOR_REVIEW',
      approvalStatus: 'READY',
    });

    // ── 3. User approves → provisioning into the CLIENT's n8n ───────────
    const approved = await designGraph.resume(run.id, { approved: true }, { userId: 'user-1' });
    expect(approved.status).toBe('COMPLETED');
    expect(approved.response).toContain('ACTIVE');

    const automation = await automations.findById('auto-1', { userId: 'user-1' });
    expect(automation.status).toBe('ACTIVE');
    expect(automation.externalWorkflowId).toBe('wf-1');
    expect(automation.webhookPath).toBe(WEBHOOK_PATH);
    expect((provisionedWorkflows.get('wf-1') as { active: boolean }).active).toBe(true);

    // ── 4. Agent run executes the automation through the client webhook ──
    const resolver = new AutomationToolResolverService(automations);
    const tools = await resolver.listTools({ userId: 'user-1' });
    const automationTool = tools.find((candidate) => candidate.slug === WEBHOOK_PATH);
    expect(automationTool).toBeTruthy();
    expect(automationTool?.binding).toEqual({ baseUrl: CLIENT_BASE, webhookPath: WEBHOOK_PATH });
    expect(automationTool?.unavailableReason).toBeUndefined();

    const executor = new N8nWorkflowExecutorService(baseConfig as never);
    const toolExecutor = new ToolExecutorService(
      {} as never, // knowledge
      {} as never, // memory
      {} as never, // llm
      {
        evaluate: vi
          .fn()
          .mockReturnValue({ tool: automationTool, requirement: { required: false } }),
        assertExecutionAllowed: vi.fn(),
      } as never,
      {
        begin: vi.fn().mockResolvedValue({ key: 'idem-1', status: 'STARTED' }),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      executor,
    );

    const toolResult = await toolExecutor.execute(automationTool!, {
      runId: 'run-2',
      agentId: 'agent-1',
      userMessage: 'Sync invoice inv-1',
      input: { invoiceId: 'inv-1' },
      userId: 'user-1',
    });

    expect(toolResult.success).toBe(true);
    expect(toolResult.output).toEqual({ invoiceId: 'inv-1', ledgerId: 'led_991' });
    expect(receivedHeaders?.['Idempotency-Key']).toBe('run-2:invoice-sync-auto-1');
    expect(receivedHeaders?.['X-Woops-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(receivedBody).toMatchObject({
      skillSlug: WEBHOOK_PATH,
      input: { invoiceId: 'inv-1' },
    });

    vi.unstubAllGlobals();
  });
});
