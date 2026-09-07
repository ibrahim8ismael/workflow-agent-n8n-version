import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { N8nNodeInventoryService } from '../../../infrastructure/n8n/n8n-node-inventory.service';
import { AutomationsService } from '../../automations/services/automations.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { N8nConnectionsService } from '../../integrations/n8n/services/n8n-connections.service';
import { AutomationDesignSessionService } from './automation-design-session.service';
import { ContextBuilderService } from './context-builder.service';
import { JaafarAutomationDesignGraphService } from './jaafar-automation-design-graph.service';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';

const blueprintOutput = {
  ready: false,
  missingRequirements: ['recipient'],
  name: 'Hello automation',
  goal: 'Say hello on a schedule',
  summary: 'Says hello',
  description: '',
  trigger: { type: 'schedule', config: { every: 10, unit: 'minutes' } },
  steps: [{ name: 'Send hello', action: 'Send message', config: {} }],
  integrations: [],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
};

const setup = () => {
  const runs = {
    create: vi.fn().mockResolvedValue({ id: 'run-1' }),
    transitionStatus: vi.fn(),
    complete: vi.fn().mockResolvedValue({ id: 'run-1' }),
    fail: vi.fn(),
    updateMetadata: vi.fn(),
    recordModelUsage: vi.fn(),
    updateUsage: vi.fn(),
    findById: vi.fn().mockResolvedValue({ id: 'run-1' }),
  };
  const conversations = {
    findByIdInScope: vi.fn().mockResolvedValue(null),
    addMessage: vi.fn(),
    titleFromFirstMessage: vi.fn(),
    updateMetadata: vi.fn(),
  } as unknown as ConversationsService;
  const contextLoader = {
    load: vi.fn().mockResolvedValue({
      agent: { id: 'agent-1', name: 'Jaafar', instructions: '' },
      history: [],
      tools: [],
      memoryReferences: [],
      knowledgeReferences: [],
      readiness: [],
    }),
  } as unknown as JaafarContextLoaderService;
  const contextBuilder = {
    build: vi.fn().mockImplementation(async ({ systemPrompt }) => ({
      system: systemPrompt,
      messages: [{ role: 'user', content: 'build it' }],
    })),
  } as unknown as ContextBuilderService;
  const sessionService = {
    load: vi.fn().mockResolvedValue({
      status: 'GATHERING_REQUIREMENTS',
      approvalStatus: 'NOT_READY',
      missingRequirements: [],
    }),
    persist: vi.fn(),
  } as unknown as AutomationDesignSessionService;
  const llmRuntime = {
    generateObject: vi.fn().mockResolvedValue({
      object: blueprintOutput,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      execution: { estimatedCost: 0 },
    }),
  } as unknown as LLMRuntimeService;
  const automations = {
    createFromBlueprint: vi.fn(),
    approve: vi.fn(),
  } as unknown as AutomationsService;
  const n8nConnections = {
    resolveActiveForScope: vi.fn().mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'http://localhost:7777',
      apiKey: 'key',
    }),
  } as unknown as N8nConnectionsService;
  const nodeInventory = {
    inventory: vi.fn().mockResolvedValue({
      nodeTypes: [
        { type: 'n8n-nodes-base.whatsApp', typeVersion: 1, inUse: true },
        { type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, inUse: false },
      ],
      dataTables: [{ id: 'dt-1', name: 'sent_log', columns: [{ name: 'text', type: 'string' }] }],
      dataTablesSupported: true,
    }),
  } as unknown as N8nNodeInventoryService;

  const service = new JaafarAutomationDesignGraphService(
    runs as never,
    conversations,
    contextLoader,
    contextBuilder,
    sessionService,
    llmRuntime,
    automations,
    n8nConnections,
    nodeInventory,
  );
  return {
    service,
    runs,
    contextBuilder,
    sessionService,
    llmRuntime,
    n8nConnections,
    nodeInventory,
  };
};

describe('JaafarAutomationDesignGraphService — instance-driven design context', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('injects the harvested node types and data tables into the design prompt', async () => {
    const { service, contextBuilder, nodeInventory, n8nConnections } = setup();

    const result = await service.run({
      agentId: 'agent-1',
      userMessage: 'send a WhatsApp hello every 10 minutes',
      conversationId: 'conv-1',
      userId: 'user-1',
    } as never);

    expect(n8nConnections.resolveActiveForScope).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: undefined,
    });
    expect(nodeInventory.inventory).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:7777',
      apiKey: 'key',
    });
    const system = vi.mocked(contextBuilder.build).mock.calls[0][0].systemPrompt as string;
    expect(system).toContain('<client_n8n_instance_capabilities>');
    expect(system).toContain('n8n-nodes-base.whatsApp');
    expect(system).toContain('sent_log');
    expect(result.status).toBe('COMPLETED');
  });

  it('designs without inventory when no connection is active', async () => {
    const { service, contextBuilder, nodeInventory } = setup();
    (nodeInventory.inventory as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('no connection'),
    );
    (n8nConnectionsCheck(service) as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await service.run({
      agentId: 'agent-1',
      userMessage: 'build something',
      conversationId: 'conv-1',
      userId: 'user-1',
    } as never);

    const system = vi.mocked(contextBuilder.build).mock.calls[0][0].systemPrompt as unknown;
    const joined = Array.isArray(system) ? system.join('\n') : String(system);
    expect(joined).not.toContain('<client_n8n_instance_capabilities>');
    expect(joined).not.toContain('n8n-nodes-base.whatsApp');
  });
});

/** Reaches the private connections mock through the constructed service. */
function n8nConnectionsCheck(service: JaafarAutomationDesignGraphService) {
  return (service as unknown as { n8nConnections: { resolveActiveForScope: unknown } })
    .n8nConnections.resolveActiveForScope as ReturnType<typeof vi.fn>;
}
