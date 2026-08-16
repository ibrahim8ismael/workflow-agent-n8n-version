import { describe, expect, it } from 'vitest';
import { JaafarMemoryPolicyService } from './jaafar-memory-policy.service';

describe('JaafarMemoryPolicyService', () => {
  const service = new JaafarMemoryPolicyService();

  it('accepts high-confidence scoped candidates', () => {
    expect(
      service.filter({
        content: 'User prefers concise status updates.',
        source: 'user-correction',
        confidence: 0.95,
        scope: 'user',
      }),
    ).toMatchObject({ content: 'User prefers concise status updates.' });
  });

  it('rejects low-confidence and sensitive candidates', () => {
    expect(
      service.filter({
        content: 'The API key is secret-token',
        source: 'model',
        confidence: 0.99,
        scope: 'agent',
      }),
    ).toBeUndefined();
    expect(
      service.filter({
        content: 'Maybe the user prefers email.',
        source: 'model',
        confidence: 0.5,
        scope: 'user',
      }),
    ).toBeUndefined();
  });
});
