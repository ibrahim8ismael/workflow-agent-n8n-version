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

  it('self-corrects at higher effort when confidence is low instead of forcing clarification', async () => {
    const llmRuntime = {
      generateObject: vi
        .fn()
        .mockResolvedValueOnce({
          object: { ...output, missingInputs: [], confidence: 0.4, clarificationRequired: false },
        })
        .mockResolvedValueOnce({
          object: {
            ...output,
            missingInputs: [],
            confidence: 0.9,
            clarificationRequired: false,
          },
        }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    await expect(
      service.understand({ userMessage: 'Do the thing', history: [], effort: 'medium' }),
    ).resolves.toMatchObject({
      route: 'automation_design',
      clarificationQuestion: undefined,
    });
    // First call medium, self-correction pass at high.
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
    expect(llmRuntime.generateObject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mode: 'high' }),
    );
  });

  it('keeps the initial intent when self-correction stays uncertain', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({
        object: { ...output, missingInputs: [], confidence: 0.4, clarificationRequired: false },
      }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    await expect(
      service.understand({ userMessage: 'Do the thing', history: [], effort: 'medium' }),
    ).resolves.toMatchObject({ route: 'automation_design', clarificationRequired: false });
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(2);
  });

  it('assigns stable requirement ids and extracts the v2 intent structure', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({
        object: {
          intent: 'automation_design',
          goal: 'Notify sales about big orders',
          businessContext: 'E-commerce',
          trigger: { kind: 'webhook', event: 'order.created', schedule: '' },
          actions: ['find customer', 'notify sales'],
          entities: ['Shopify', 'Slack'],
          conditions: ['order total above $500'],
          constraints: [],
          desiredOutcome: 'Sales notified for every big order',
          requirements: [
            { field: 'channel', value: 'sales Slack channel', required: true, source: 'user' },
            { field: 'threshold', value: '$500', required: false, source: 'inferred' },
          ],
          assumptions: [
            {
              statement: 'Sales channel is #sales',
              rationale: 'only sales channel connected',
              reversible: true,
              risk: 'low',
            },
          ],
          missingInputs: [],
          confidence: 0.9,
          clarificationRequired: false,
        },
      }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    const result = await service.understand({ userMessage: 'Notify sales', history: [] });

    expect(result.route).toBe('automation_design');
    expect(result.requirements.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(result.trigger).toMatchObject({ kind: 'webhook', event: 'order.created' });
    expect(result.actions).toContain('notify sales');
    expect(result.assumptions).toMatchObject([
      { statement: 'Sales channel is #sales', needsConfirmation: false },
    ]);
    // One LLM call — no self-correction at high confidence.
    expect(llmRuntime.generateObject).toHaveBeenCalledTimes(1);
  });

  it('forces confirmation for high-risk or irreversible assumptions', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({
        object: {
          ...output,
          missingInputs: [],
          clarificationRequired: false,
          confidence: 0.9,
          assumptions: [
            {
              statement: 'Delete old contacts without backup',
              rationale: 'user said clean up',
              reversible: false,
              risk: 'high',
            },
          ],
        },
      }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    const result = await service.understand({ userMessage: 'Clean up contacts', history: [] });

    expect(result.route).toBe('clarification');
    expect(result.clarificationRequired).toBe(true);
    expect(result.clarificationQuestion).toContain('Delete old contacts without backup');
    expect(result.assumptions[0]).toMatchObject({ needsConfirmation: true });
  });

  it('includes the pending follow-up question in the prompt', async () => {
    const llmRuntime = {
      generateObject: vi.fn().mockResolvedValue({ object: output }),
    };
    const service = new JaafarRequestUnderstandingService(llmRuntime as never);

    await service.understand({
      userMessage: '+212600000000',
      history: [],
      pendingContext: {
        question: 'Which number should receive the messages?',
        priorUserMessage: 'build a WhatsApp automation',
        intent: 'automation_design',
      },
    });

    const prompt = vi.mocked(llmRuntime.generateObject).mock.calls[0]?.[0] as unknown as {
      messages: Array<{ content: string }>;
    };
    const content = prompt.messages.map((m) => m.content).join('\n');
    expect(content).toContain('Which number should receive the messages?');
    expect(content).toContain('automation_design');
  });
});
