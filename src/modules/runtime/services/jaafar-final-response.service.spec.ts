import { describe, expect, it, vi } from 'vitest';
import { JaafarFinalResponseService } from './jaafar-final-response.service';

describe('JaafarFinalResponseService', () => {
  it('generates a grounded response through the model gateway', async () => {
    const llmRuntime = {
      generateText: vi.fn().mockResolvedValue({
        content: 'The report was sent successfully.',
        usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
        execution: {
          executionId: 'response-1',
          mode: 'medium',
          provider: 'openai',
          model: 'gpt-4o',
          durationMs: 20,
          retries: 0,
          estimatedCost: 0.01,
        },
      }),
    };
    const service = new JaafarFinalResponseService(llmRuntime as never);

    await expect(
      service.generate({
        userMessage: 'Send the report',
        results: [
          {
            callId: 'call-1',
            toolId: 'send_report',
            success: true,
            output: { accepted: true },
            durationMs: 10,
          },
        ],
      }),
    ).resolves.toMatchObject({
      response: 'The report was sent successfully.',
      modelCall: { purpose: 'response', usage: { totalTokens: 18 } },
    });

    expect(llmRuntime.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'medium', messages: expect.any(Array) }),
    );
  });
});
