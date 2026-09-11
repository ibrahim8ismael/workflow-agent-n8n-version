import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentsService } from '../../agents/services/agents.service';
import type { ChannelsService } from '../../channels/services/channels.service';
import type { ConversationsService } from '../../conversations/services/conversations.service';
import type { IntegrationsService } from '../../integrations/services/integrations.service';
import type { KnowledgeService } from '../../knowledge/services/knowledge.service';
import type { MemoryService } from '../../memory/services/memory.service';
import type { ToolDefinition } from '../interfaces/tool.interface';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import type { ToolRegistryService } from './tool-registry.service';

describe('JaafarContextLoaderService', () => {
  const agent = {
    id: 'agent-1',
    name: 'Support',
    description: 'Support employee',
    instructions: 'Be helpful',
    organizationId: 'org-1',
  };
  const tool = { id: 'knowledge_search', name: 'Knowledge' } as ToolDefinition;
  let service: JaafarContextLoaderService;
  let agents: { findById: ReturnType<typeof vi.fn> };
  let conversations: { getMessages: ReturnType<typeof vi.fn> };
  let tools: { listForAgent: ReturnType<typeof vi.fn> };
  let memory: { findByAgent: ReturnType<typeof vi.fn> };
  let knowledge: { search: ReturnType<typeof vi.fn> };
  let integrations: { isConnected: ReturnType<typeof vi.fn> };
  let channels: { isAvailable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    agents = { findById: vi.fn().mockResolvedValue(agent) };
    conversations = { getMessages: vi.fn().mockResolvedValue([]) };
    tools = { listForAgent: vi.fn().mockResolvedValue([tool]) };
    memory = { findByAgent: vi.fn().mockResolvedValue([]) };
    knowledge = { search: vi.fn().mockResolvedValue([]) };
    integrations = { isConnected: vi.fn().mockResolvedValue(true) };
    channels = { isAvailable: vi.fn().mockResolvedValue(false) };
    service = new JaafarContextLoaderService(
      agents as unknown as AgentsService,
      conversations as unknown as ConversationsService,
      tools as unknown as ToolRegistryService,
      memory as unknown as MemoryService,
      knowledge as unknown as KnowledgeService,
      integrations as unknown as IntegrationsService,
      channels as unknown as ChannelsService,
    );
  });

  it('loads scoped agent context with bounded history and tool assignment', async () => {
    conversations.getMessages.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({ role: 'user', content: `message-${index}` })),
    );
    memory.findByAgent.mockResolvedValue([{ id: 'memory-1' }]);
    knowledge.search.mockResolvedValue([{ knowledgeDocumentId: 'doc-1' }]);

    const result = await service.load({
      agentId: 'agent-1',
      userId: 'user-1',
      organizationId: 'org-1',
      conversationId: 'conversation-1',
      userMessage: 'What is our refund policy?',
      mode: 'conversation',
    });

    expect(agents.findById).toHaveBeenCalledWith('agent-1', false, {
      userId: 'user-1',
      organizationId: 'org-1',
    });
    expect(conversations.getMessages).toHaveBeenCalledWith(
      'conversation-1',
      { take: 20, order: 'desc' },
      { userId: 'user-1', organizationId: 'org-1' },
    );
    expect(tools.listForAgent).toHaveBeenCalledWith('agent-1', {
      mode: 'conversation',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    expect(memory.findByAgent).toHaveBeenCalledWith('agent-1', { userId: 'user-1', take: 5 });
    expect(knowledge.search).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      query: 'What is our refund policy?',
      limit: 5,
      offset: 0,
    });
    expect(result.history).toHaveLength(20);
    expect(result.memoryReferences).toEqual(['memory-1']);
    expect(result.knowledgeReferences).toEqual(['doc-1']);
  });

  it('loads the RECENT history window in chronological order', async () => {
    // Regression: asc + take returned the OLDEST 20 messages of a long
    // conversation — understanding/planning operated on stale history.
    conversations.getMessages.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        role: 'user',
        content: `recent-${19 - index}`,
      })),
    );

    const result = await service.load({
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      userMessage: 'What changed?',
    });

    expect(result.history[0]?.content).toBe('recent-0');
    expect(result.history[19]?.content).toBe('recent-19');
  });

  it('rejects history reads outside the caller scope', async () => {
    // Tenant isolation: the loader passes the caller scope down — a
    // foreign conversationId must not leak its messages.
    const { NotFoundException } = await import('@nestjs/common');
    conversations.getMessages.mockRejectedValue(new NotFoundException('not found'));

    await expect(
      service.load({
        agentId: 'agent-1',
        userId: 'intruder',
        conversationId: 'foreign-conversation',
        userMessage: 'What is our refund policy?',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(conversations.getMessages).toHaveBeenCalledWith(
      'foreign-conversation',
      { take: 20, order: 'desc' },
      { userId: 'intruder', organizationId: undefined },
    );
  });

  it('loads readiness only when requested and bounds capabilities', async () => {
    const readiness = Array.from({ length: 8 }, (_, index) => `capability-${index}`);

    const result = await service.load({
      agentId: 'agent-1',
      organizationId: 'org-1',
      userMessage: 'Check integrations',
      readiness,
    });

    expect(integrations.isConnected).toHaveBeenCalledTimes(5);
    expect(channels.isAvailable).toHaveBeenCalledTimes(5);
    expect(result.readiness).toHaveLength(5);
  });

  it('does not retrieve readiness or unscoped history without a conversation', async () => {
    const result = await service.load({ agentId: 'agent-1', userMessage: 'Hello' });

    expect(conversations.getMessages).not.toHaveBeenCalled();
    expect(integrations.isConnected).not.toHaveBeenCalled();
    expect(channels.isAvailable).not.toHaveBeenCalled();
    expect(result.history).toEqual([]);
    expect(result.readiness).toEqual([]);
  });
});
