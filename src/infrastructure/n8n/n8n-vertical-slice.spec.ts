import { describe, expect, it, vi, vi as viCore } from 'vitest';

// SSRF guard must not hit real DNS in tests — resolve to a public IP.
vi.mock('node:dns/promises', () => ({
  lookup: viCore.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

import { AutomationsRepository } from '../../modules/automations/repositories/automations.repository';
import { AutomationsService } from '../../modules/automations/services/automations.service';
import { N8nConnectionsRepository } from '../../modules/integrations/n8n/repositories/n8n-connections.repository';
import { N8nConnectionsService } from '../../modules/integrations/n8n/services/n8n-connections.service';
import { AutomationErrorClassifierService } from '../../modules/runtime/services/automation-error-classifier.service';
import { AutomationPlanReviewService } from '../../modules/runtime/services/automation-plan-review.service';
import { AutomationRepairService } from '../../modules/runtime/services/automation-repair.service';
import { AutomationRuntimeValidatorService } from '../../modules/runtime/services/automation-runtime-validator.service';
import { AutomationToolResolverService } from '../../modules/runtime/services/automation-tool-resolver.service';
import { AutomationWorkflowBuilderService } from '../../modules/runtime/services/automation-workflow-builder.service';
import { JaafarAutomationGraphService } from '../../modules/runtime/services/jaafar-automation-graph.service';
import { JaafarContextLoaderService } from '../../modules/runtime/services/jaafar-context-loader.service';
import { ToolExecutorService } from '../../modules/runtime/services/tool-executor.service';
import { SecretBoxService } from '../crypto/secret-box.service';
import { LLMRuntimeService } from '../llm-runtime/llm-runtime.service';
import { N8nClientApiService } from './n8n-client-api.service';
import { N8nNodeInventoryService } from './n8n-node-inventory.service';
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
        if (
          url === `${CLIENT_BASE}/api/v1/workflows?limit=1` ||
          url === `${CLIENT_BASE}/api/v1/workflows?limit=100`
        ) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ data: [] }),
          };
        }
        if (url === `${CLIENT_BASE}/api/v1/data-tables` && init?.method === 'POST') {
          expect(headers['X-N8N-API-KEY']).toBeTruthy();
          const payload = JSON.parse(init.body as string) as { name: string };
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'dt-1', name: payload.name, columns: [] }),
          };
        }
        if (url === `${CLIENT_BASE}/api/v1/data-tables`) {
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
    const _contextBuilder = {
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
      trigger: { type: 'schedule' as const, config: { every: 10, unit: 'minutes' } },
      steps: [
        {
          name: 'Fetch invoices',
          action: 'Fetch paid invoices',
          integration: 'stripe',
          requirementIds: ['R1'],
          config: {},
        },
        {
          name: 'Log row',
          action: 'Record the sync in the log table',
          integration: 'dataTable',
          requirementIds: ['R2'],
          config: {},
          nodeHint: {
            type: 'n8n-nodes-base.dataTable',
            typeVersion: 1,
            parameters: { operation: 'insert', tableName: 'sent_log' },
          },
        },
      ],
      dataTables: [{ name: 'sent_log', columns: [{ name: 'text', type: 'string' }] }],
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

    // ── 2. Jaafar designs an automation (mock LLM, real V2 graph) ──────────
    const agentRuns = {
      createAgentRun: vi.fn().mockImplementation(async () => run),
      advance: vi.fn().mockImplementation(async (_id: string, change: Record<string, unknown>) => {
        if (typeof change.toStatus === 'string') run.status = change.toStatus;
        return run;
      }),
      recordArtifacts: vi.fn().mockResolvedValue(run),
      snapshot: vi.fn().mockImplementation(async () => ({ run, transitions: [] })),
    };
    const contextManager = {
      buildForStage: vi
        .fn()
        .mockResolvedValue({ stage: 'PLANNING', agentId: 'agent-1', sections: {} }),
      renderToPromptText: vi.fn().mockReturnValue('automation context'),
    };
    const understandingService = {
      understand: vi.fn().mockResolvedValue({
        route: 'automation_design',
        intent: 'automation_design',
        goal: 'Sync paid invoices into the ledger',
        businessContext: '',
        trigger: { kind: 'schedule', event: '', schedule: 'every 10 minutes' },
        actions: ['fetch invoices', 'log sync'],
        entities: ['stripe'],
        conditions: [],
        constraints: [],
        desiredOutcome: 'ledger synced daily',
        requirements: [
          { id: 'R1', field: 'fetch', value: 'paid invoices', required: true, source: 'user' },
          { id: 'R2', field: 'log', value: 'sync log', required: true, source: 'user' },
        ],
        assumptions: [],
        missingInputs: [],
        confidence: 0.95,
        clarificationRequired: false,
        modelCall: {
          purpose: 'understanding',
          execution: {},
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      }),
    };
    const registry = {
      capabilitiesForScope: vi.fn().mockResolvedValue([
        {
          provider: 'stripe',
          displayName: 'Stripe',
          source: 'n8n',
          connectionStatus: 'CONNECTED',
          credentialsAvailable: true,
        },
        {
          provider: 'datatable',
          displayName: 'Datatable',
          source: 'n8n',
          connectionStatus: 'CONNECTED',
          credentialsAvailable: false,
        },
      ]),
    };
    const nodeInventory = new N8nNodeInventoryService(clientApi);
    const validator = new AutomationRuntimeValidatorService(
      new N8nWorkflowExecutorService(baseConfig as never),
      new AutomationErrorClassifierService(),
    );
    const repair = new AutomationRepairService(llmRuntime as unknown as LLMRuntimeService);
    const builder = new AutomationWorkflowBuilderService(
      new AutomationPlanReviewService(),
      automations,
      agentRuns as never,
      connections,
      nodeInventory,
    );
    const automationGraph = new JaafarAutomationGraphService(
      agentRuns as never,
      runs as never,
      conversations as never,
      contextManager as never,
      contextLoader as unknown as JaafarContextLoaderService,
      understandingService as never,
      registry as never,
      new AutomationPlanReviewService(),
      builder,
      validator,
      repair,
      new AutomationErrorClassifierService(),
      llmRuntime as unknown as LLMRuntimeService,
      clientApi,
      connections,
      nodeInventory,
    );

    const designResult = await automationGraph.run({
      runId: run.id,
      agentId: 'agent-1',
      userMessage: 'Design an invoice sync automation',
      userId: 'user-1',
      effort: 'low' as const,
    });
    expect(designResult.status).toBe('WAITING'); // approval gate
    expect(run.metadata.automationV2).toBe(true);

    // ── 3. User approves → provisioning into the CLIENT's n8n ───────────
    const approved = await automationGraph.resume(run.id, { approved: true }, { userId: 'user-1' });
    expect(approved.status).toBe('COMPLETED');
    expect(approved.response).toContain('ACTIVE');
    // Completion requires the full pipeline — static validation, test
    // execution against the webhook, and live verification.
    expect(approved.response).toContain('executed against test data');

    const automation = await automations.findById('auto-1', { userId: 'user-1' });
    expect(automation.status).toBe('ACTIVE');
    expect(automation.externalWorkflowId).toBe('wf-1');
    expect(automation.webhookPath).toBe(WEBHOOK_PATH);
    expect((provisionedWorkflows.get('wf-1') as { active: boolean }).active).toBe(true);

    // Native node provisioning: dual trigger + real data table id injected.
    const provisionedNodes = (
      provisionedWorkflows.get('wf-1') as {
        nodes: Array<{ type: string; parameters?: Record<string, unknown> }>;
      }
    ).nodes;
    const nodeTypes = provisionedNodes.map((node) => node.type);
    expect(nodeTypes).toContain('n8n-nodes-base.scheduleTrigger');
    expect(nodeTypes).toContain('n8n-nodes-base.webhook');
    expect(nodeTypes).toContain('n8n-nodes-base.dataTable');
    expect(
      provisionedNodes.find((node) => node.type === 'n8n-nodes-base.scheduleTrigger')?.parameters,
    ).toMatchObject({ rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } });
    expect(
      provisionedNodes.find((node) => node.type === 'n8n-nodes-base.dataTable')?.parameters,
    ).toMatchObject({
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'dt-1' },
    });

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
