import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import { ContextBuilderService } from './context-builder.service';

describe('ContextBuilderService', () => {
  let service: ContextBuilderService;

  const mockMemoryService = { findByAgent: vi.fn() } as unknown as MemoryService;
  const mockKnowledgeService = { search: vi.fn() } as unknown as KnowledgeService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockMemoryService.findByAgent).mockResolvedValue([]);
    vi.mocked(mockKnowledgeService.search).mockResolvedValue([]);
    service = new ContextBuilderService(mockMemoryService, mockKnowledgeService);
  });

  it('builds prompts, preserves recent history, and appends the user message', async () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      role: 'user',
      content: `message-${index}`,
    }));

    const result = await service.build({
      systemPrompt: 'You are helpful.',
      agentInstructions: 'Be concise.',
      skillInstructions: 'Follow the plan.',
      agentId: 'agent-1',
      userMessage: 'Hello',
      conversationHistory: history,
    });

    expect(result.system).toBe('You are helpful.\n\nBe concise.\n\nFollow the plan.');
    expect(result.messages).toHaveLength(21);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'message-5' });
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: 'Hello' });
    expect(result.metadata.knowledgeCount).toBe(0);
  });

  it('injects relevant memories', async () => {
    vi.mocked(mockMemoryService.findByAgent).mockResolvedValue([
      { key: 'last-topic', content: 'Q2 revenue', type: 'CONVERSATION' },
    ] as never);

    const result = await service.build({
      agentId: 'agent-1',
      userMessage: 'Summarize Q2 revenue',
    });

    expect(result.messages).toContainEqual({
      role: 'system',
      content: 'Relevant memories:\n[Memory: last-topic] Q2 revenue',
    });
    expect(result.metadata.memoryCount).toBe(1);
  });

  it('retrieves organization-scoped approved knowledge before memory', async () => {
    vi.mocked(mockKnowledgeService.search).mockResolvedValue([
      { knowledgeDocumentId: 'doc-1', content: 'Revenue policy' },
    ] as never);

    const result = await service.build({
      agentId: 'agent-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'Summarize revenue',
    });

    expect(mockKnowledgeService.search).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      query: 'Summarize revenue',
      limit: 5,
      offset: 0,
    });
    expect(result.messages).toContainEqual({
      role: 'system',
      content: expect.stringContaining('[Knowledge: doc-1] Revenue policy'),
    });
    expect(result.metadata.knowledgeCount).toBe(1);
  });

  it('degrades gracefully when memory retrieval fails', async () => {
    vi.mocked(mockMemoryService.findByAgent).mockRejectedValue(new Error('db down'));

    const result = await service.build({ agentId: 'agent-1', userMessage: 'Hello' });

    expect(result.metadata.memoryCount).toBe(0);
  });
});
