import { describe, expect, it, vi } from 'vitest';
import { RuntimeMode } from '../types/runtime.types';
import { JaafarConversationGraphService } from './jaafar-conversation-graph.service';

describe('JaafarConversationGraphService', () => {
  it('generates and persists a grounded conversation response through the graph', async () => {
    const runs = {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      transitionStatus: vi.fn(),
      updateMetadata: vi.fn(),
      updateUsage: vi.fn(),
      complete: vi.fn().mockResolvedValue({ id: 'run-1' }),
      fail: vi.fn(),
    };
    const conversations = {
      addMessage: vi.fn(),
      titleFromFirstMessage: vi.fn(),
    };
    const contextLoader = {
      load: vi.fn().mockResolvedValue({
        agent: { id: 'agent-1', name: 'Jaafar', instructions: 'Be concise.' },
        history: [{ role: 'user', content: 'Earlier question' }],
        tools: [],
        memoryReferences: [],
        knowledgeReferences: [],
        readiness: [],
      }),
    };
    const contextBuilder = {
      build: vi.fn().mockResolvedValue({
        system: 'system',
        messages: [{ role: 'user', content: 'What is the policy?' }],
      }),
    };
    const llmRuntime = {
      generateText: vi.fn().mockResolvedValue({
        content: 'The policy is documented in the handbook.',
        usage: { promptTokens: 4, completionTokens: 8, totalTokens: 12 },
        execution: { durationMs: 10, estimatedCost: 0.01 },
      }),
    };
    const service = new JaafarConversationGraphService(
      runs as never,
      conversations as never,
      contextLoader as never,
      contextBuilder as never,
      llmRuntime as never,
    );

    const result = await service.run({
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      organizationId: 'org-1',
      userMessage: 'What is the policy?',
      mode: RuntimeMode.CONVERSATION,
    });

    expect(result.response).toBe('The policy is documented in the handbook.');
    expect(runs.updateUsage).toHaveBeenCalledWith('run-1', {
      promptTokens: 4,
      completionTokens: 8,
      totalTokens: 12,
    });
    expect(conversations.addMessage).toHaveBeenCalledTimes(2);
    expect(runs.complete).toHaveBeenCalledWith(
      'run-1',
      'The policy is documented in the handbook.',
    );
  });
});
