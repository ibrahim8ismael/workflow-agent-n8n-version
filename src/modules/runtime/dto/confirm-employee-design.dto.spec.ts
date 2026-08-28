import { describe, expect, it } from 'vitest';
import { confirmEmployeeDesignSchema } from './confirm-employee-design.dto';

const revision = 'a'.repeat(64);

describe('confirmEmployeeDesignSchema', () => {
  it('rejects explicit false confirmation', () => {
    expect(
      confirmEmployeeDesignSchema.safeParse({ confirm: false, blueprintRevision: revision })
        .success,
    ).toBe(false);
  });

  it('accepts a valid approval payload with or without revision', () => {
    expect(
      confirmEmployeeDesignSchema.safeParse({ confirm: true, blueprintRevision: revision }).success,
    ).toBe(true);
    expect(confirmEmployeeDesignSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(confirmEmployeeDesignSchema.safeParse({ confirmed: true }).success).toBe(true);
  });
});
