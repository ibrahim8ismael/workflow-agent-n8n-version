import { describe, expect, it } from 'vitest';
import { confirmAutomationDesignSchema } from './confirm-automation-design.dto';

describe('confirmAutomationDesignSchema', () => {
  it('rejects explicit false confirmations', () => {
    expect(confirmAutomationDesignSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(confirmAutomationDesignSchema.safeParse({ confirmed: false }).success).toBe(false);
  });

  it('accepts true confirmations with an optional blueprint revision', () => {
    expect(
      confirmAutomationDesignSchema.safeParse({ confirm: true, blueprintRevision: 'rev-1' })
        .success,
    ).toBe(true);
    expect(confirmAutomationDesignSchema.safeParse({ confirmed: true }).success).toBe(true);
    expect(confirmAutomationDesignSchema.safeParse({}).success).toBe(true);
  });
});
