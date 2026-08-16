import { describe, expect, it } from 'vitest';
import { confirmEmployeeDesignSchema } from './confirm-employee-design.dto';

const revision = 'a'.repeat(64);

describe('confirmEmployeeDesignSchema', () => {
  it('requires explicit approval and a blueprint revision', () => {
    expect(confirmEmployeeDesignSchema.safeParse({}).success).toBe(false);
    expect(
      confirmEmployeeDesignSchema.safeParse({ confirm: false, blueprintRevision: revision })
        .success,
    ).toBe(false);
  });

  it('accepts only a valid approval payload', () => {
    expect(
      confirmEmployeeDesignSchema.safeParse({ confirm: true, blueprintRevision: revision }).success,
    ).toBe(true);
  });
});
