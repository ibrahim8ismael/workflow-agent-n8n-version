import { describe, expect, it } from 'vitest';
import { jaafarUnderstandingSchema } from './jaafar-understanding.schema';

const base = {
  intent: 'automation_design',
  goal: 'Send WhatsApp updates',
  trigger: { kind: 'schedule', event: '', schedule: 'every 10 minutes' },
  actions: ['send message'],
  entities: ['WhatsApp'],
  conditions: [],
  constraints: [],
  desiredOutcome: 'messages sent',
  requirements: [],
  assumptions: [],
  missingInputs: [],
  confidence: 0.9,
  clarificationRequired: false,
};

describe('jaafarUnderstandingSchema genericNodeOverride', () => {
  it('defaults to no override so native nodes stay eligible', () => {
    const parsed = jaafarUnderstandingSchema.parse(base);

    expect(parsed.genericNodeOverride).toEqual({ requested: false });
  });

  it('preserves an explicit HTTP override through parsing', () => {
    const parsed = jaafarUnderstandingSchema.parse({
      ...base,
      genericNodeOverride: { requested: true, type: 'httpRequest' },
    });

    expect(parsed.genericNodeOverride).toEqual({ requested: true, type: 'httpRequest' });
  });

  it('preserves an explicit Code override through parsing', () => {
    const parsed = jaafarUnderstandingSchema.parse({
      ...base,
      genericNodeOverride: { requested: true, type: 'code' },
    });

    expect(parsed.genericNodeOverride?.requested).toBe(true);
  });
});
