import { describe, expect, it, vi } from 'vitest';
import { JaafarRequestUnderstandingService } from './jaafar-request-understanding.service';

const output = {
  intent: 'automation_design' as const,
  goal: 'Create a support automation',
  businessContext: 'Customer support',
  requirements: [{ field: 'role', value: 'support', required: true, source: 'user' as const }],
  missingInputs: [
    {
      field: 'channels',
      description: 'Channels the automation should use',
      question: 'Which channels should the automation use?',
      required: true,
    },
  ],
  confidence: 0.95,
  clarificationRequired: false,
};

describe('JaafarRequestUnderstandingService', () => {
  it('returns a focused clarification route for missing requirements', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({ object: output }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    await expect(
      service.understand({
        userMessage: 'Create a support automation',
        history: [],
        effort: 'low',
      }),
    ).resolves.toMatchObject({
      route: 'clarification',
      clarificationRequired: true,
      clarificationQuestion: 'Which channels should the automation use?',
    });

    expect(llmRuntime.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ schema: expect.anything(), mode: 'low' }),
    );
  });

  it('routes a confident general question without clarification', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({
        object: {
          ...output,
          intent: 'general_question',
          goal: 'Explain the refund policy',
          missingInputs: [],
          clarificationRequired: false,
          confidence: 0.98,
        },
      }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    await expect(
      service.understand({ userMessage: 'What is our refund policy?', history: [] }),
    ).resolves.toMatchObject({ route: 'general_question', clarificationRequired: false });
  });

  it('provides a focused question when confidence is low', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({
        object: { ...output, missingInputs: [], confidence: 0.4, clarificationRequired: false },
      }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    await expect(
      service.understand({ userMessage: 'Do the thing', history: [] }),
    ).resolves.toMatchObject({
      route: 'clarification',
      clarificationQuestion: 'What outcome would you like Jaafar to help you achieve?',
    });
  });
});
