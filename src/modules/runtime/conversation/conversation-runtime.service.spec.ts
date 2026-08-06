import { describe, expect, it, vi } from 'vitest';
import { RuntimeMode } from '../types/runtime.types';
import { ConversationRuntimeService } from './conversation-runtime.service';

describe('ConversationRuntimeService', () => {
  it('uses one text generation path and does not load execution dependencies', async () => {
    const runsService = {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      transitionStatus: vi.fn(),
      updateUsage: vi.fn(),
      updateMetadata: vi.fn(),
      complete: vi.fn().mockResolvedValue({
        id: 'run-1',
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      }),
      fail: vi.fn(),
    };
    const agentsService = {
      findById: vi.fn().mockResolvedValue({ instructions: 'Be helpful.' }),
    };
    const conversationsService = {
      getMessages: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
    };
    const contextBuilder = {
      build: vi.fn().mockResolvedValue({
        system: 'system',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    };
    const llmRuntime = {
      generateText: vi.fn().mockResolvedValue({
        content: 'Hi',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        execution: { durationMs: 10 },
      }),
      generateObject: vi.fn(),
    };
    const service = new ConversationRuntimeService(
      runsService as never,
      agentsService as never,
      conversationsService as never,
      contextBuilder as never,
      llmRuntime as never,
      { get: vi.fn().mockResolvedValue(null), set: vi.fn() } as never,
    );

    const result = await service.run({
      agentId: 'agent-1',
      conversationId: 'conversation-1',
      userMessage: 'Hello',
      mode: RuntimeMode.CONVERSATION,
    });

    expect(result.response).toBe('Hi');
    expect(llmRuntime.generateText).toHaveBeenCalledTimes(1);
    expect(llmRuntime.generateObject).not.toHaveBeenCalled();
    expect(agentsService.findById).toHaveBeenCalledWith('agent-1');
    expect(conversationsService.getMessages).toHaveBeenCalledWith('conversation-1', { take: 20 });
    expect(conversationsService.addMessage).toHaveBeenCalledTimes(2);
  });

  it('streams tokens before the completed event', async () => {
    const runsService = {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      transitionStatus: vi.fn(),
      updateUsage: vi.fn().mockResolvedValue(undefined),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue({
        id: 'run-1',
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      }),
      fail: vi.fn(),
    };
    const llmRuntime = {
      generateStream: async function* () {
        yield { type: 'text', content: 'Hello' };
        yield { type: 'text', content: ' world' };
        yield {
          type: 'finish',
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        };
      },
    };
    const service = new ConversationRuntimeService(
      runsService as never,
      { findById: vi.fn().mockResolvedValue({ instructions: 'Be helpful.' }) } as never,
      { getMessages: vi.fn().mockResolvedValue([]), addMessage: vi.fn() } as never,
      {
        build: vi.fn().mockResolvedValue({
          system: 'system',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      } as never,
      llmRuntime as never,
      { get: vi.fn().mockResolvedValue(null), set: vi.fn() } as never,
    );

    const events = [];
    for await (const event of service.stream({
      agentId: 'agent-1',
      userMessage: 'Hello',
      mode: 'conversation' as never,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'token',
      'token',
      'run.completed',
    ]);
    expect(events[1]).toMatchObject({ content: 'Hello' });
  });
});
