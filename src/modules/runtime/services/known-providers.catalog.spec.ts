import { describe, expect, it } from 'vitest';
import {
  canonicalProvider,
  expectedCredentialTypes,
  isKnownProvider,
} from './known-providers.catalog';

describe('known-providers catalog', () => {
  it('recognizes connected-or-disconnected providers as known', () => {
    for (const provider of ['gmail', 'slack', 'shopify', 'hubspot', 'whatsapp', 'zoho']) {
      expect(isKnownProvider(provider)).toBe(true);
    }
    expect(canonicalProvider('Gmail')).toBe('gmail');
    expect(canonicalProvider('google_sheets')).toBe('google_sheets');
  });

  it('rejects hallucinated providers as unknown', () => {
    expect(isKnownProvider('FakeCRMPro')).toBe(false);
    expect(canonicalProvider('FakeCRMPro')).toBeNull();
    expect(isKnownProvider('PENDING')).toBe(false);
    expect(isKnownProvider('')).toBe(false);
  });

  it('exposes expected credential types without secrets', () => {
    expect(expectedCredentialTypes('gmail')).toContain('gmailOAuth2');
    expect(expectedCredentialTypes('slack')).toContain('slackOAuth2Api');
    expect(expectedCredentialTypes('FakeCRMPro')).toEqual([]);
  });
});
