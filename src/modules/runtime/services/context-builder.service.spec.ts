import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import { ContextBuilderService } from './context-builder.service';

describe('ContextBuilderService', () => {
  let service: ContextBuilderService;

  const mockMemoryService = {
    findByAgent: vi.fn(),
  } as unknown as MemoryService;

  const mockKnowledgeService = {
    search: vi.fn(),
  } as unknown as KnowledgeService;

  const baseInput = {
    systemPrompt: 'You are a helpful AI employee.',
    agentId: 'agent-1',
    organizationId: 'org-1',
    userMessage: 'Summarize Q2 revenue',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockMemoryService.findByAgent).mockResolvedValue([]);
    vi.mocked(mockKnowledgeService.search).mockResolvedValue([]);
    service = new ContextBuilderService(mockMemoryService, mockKnowledgeService);
  });

  describe('build', () => {
    it('should build system prompt from all provided parts', async () => {
      const result = await service.build({
        ...baseInput,
        agentInstructions: 'Be concise.',
        skillInstructions: 'Follow the plan.',
      });

      expect(result.system).toContain('You are a helpful AI employee.');
      expect(result.system).toContain('Be concise.');
      expect(result.system).toContain('Follow the plan.');
      expect(result.system).toContain('\n\n');
    });

    it('should end messages with the user message', async () => {
      const result = await service.build(baseInput);

      expect(result.messages).toEqual([{ role: 'user', content: 'Summarize Q2 revenue' }]);
    });

    it('should include only the last 20 conversation messages', async () => {
      const history = Array.from({ length: 25 }, (_, i) => ({
        role: 'user',
        content: `msg-${i}`,
      }));

      const result = await service.build({ ...baseInput, conversationHistory: history });

      const historyMessages = result.messages.filter(
        (m) => m.role === 'user' && m.content.startsWith('msg-'),
      );
      expect(historyMessages).toHaveLength(20);
      expect(historyMessages[0].content).toBe('msg-5');
      expect(result.messages.at(-1)?.content).toBe('Summarize Q2 revenue');
    });

    it('should inject relevant memories as a system message', async () => {
      vi.mocked(mockMemoryService.findByAgent).mockResolvedValue([
        { key: 'last-topic', content: 'Q2 revenue', type: 'CONVERSATION' },
      ] as never);

      const result = await service.build(baseInput);

      expect(mockMemoryService.findByAgent).toHaveBeenCalledWith('agent-1', { take: 5 });
      expect(result.messages).toContainEqual({
        role: 'system',
        content: 'Relevant memories:\n[Memory: last-topic] Q2 revenue',
      });
      expect(result.metadata.memoryCount).toBe(1);
    });

    it('should degrade gracefully when memory retrieval fails', async () => {
      vi.mocked(mockMemoryService.findByAgent).mockRejectedValue(new Error('db down'));

      const result = await service.build(baseInput);

      expect(result.metadata.memoryCount).toBe(0);
    });

    it('should inject relevant knowledge when an organization is present', async () => {
      vi.mocked(mockKnowledgeService.search).mockResolvedValue([
        { content: 'Revenue grew 20%' },
      ] as never);

      const result = await service.build(baseInput);

      expect(mockKnowledgeService.search).toHaveBeenCalledWith({
        query: 'Summarize Q2 revenue',
        organizationId: 'org-1',
        limit: 3,
        offset: 0,
      });
      expect(result.messages).toContainEqual({
        role: 'system',
        content: 'Relevant knowledge:\n[Knowledge] Revenue grew 20%',
      });
      expect(result.metadata.knowledgeCount).toBe(1);
    });

    it('should degrade gracefully when knowledge search fails', async () => {
      vi.mocked(mockKnowledgeService.search).mockRejectedValue(new Error('pgvector down'));

      const result = await service.build(baseInput);

      expect(result.metadata.knowledgeCount).toBe(0);
    });

    it('should skip knowledge retrieval when organizationId is missing', async () => {
      await service.build({ ...baseInput, organizationId: undefined });

      expect(mockKnowledgeService.search).not.toHaveBeenCalled();
    });

    it('should estimate token counts in metadata', async () => {
      const result = await service.build({
        ...baseInput,
        agentInstructions: 'Be concise.',
        conversationHistory: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.metadata.totalTokens).toBeGreaterThan(0);
      expect(result.metadata.totalTokens).toBe(
        Math.ceil(result.system.length / 4) +
          result.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
      );
    });
  });
});
