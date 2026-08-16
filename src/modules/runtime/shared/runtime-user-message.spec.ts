import { describe, expect, it } from 'vitest';
import { runtimeUserErrorMessage } from './runtime-user-message';

describe('runtimeUserErrorMessage', () => {
  it('maps internal errors to business-safe messages', () => {
    const response = runtimeUserErrorMessage(
      new Error('OpenAI provider timed out with request id abc-123'),
    );

    expect(response).toContain('took too long');
    expect(response).not.toContain('OpenAI');
    expect(response).not.toContain('abc-123');
  });

  it('does not expose external Woops identity failures', () => {
    const response = runtimeUserErrorMessage(new Error('agent is external to Woops team'));

    expect(response).not.toContain('external');
    expect(response).not.toContain('Woops team');
  });

  it('preserves useful approval guidance', () => {
    expect(runtimeUserErrorMessage(new Error('human approval required'))).toBe(
      'This action is waiting for your approval before it can continue.',
    );
  });
});
