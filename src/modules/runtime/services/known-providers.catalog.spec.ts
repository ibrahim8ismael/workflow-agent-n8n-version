import { describe, expect, it } from 'vitest';
import {
  canonicalProvider,
  expectedCredentialTypes,
  isKnownNativeNodeForProvider,
  isKnownProvider,
  knownNativeNodeTypes,
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

  it('maps known native nodes including trigger variants', () => {
    expect(knownNativeNodeTypes('gmail')).toContain('n8n-nodes-base.gmailTrigger');
    expect(isKnownNativeNodeForProvider('gmail', 'n8n-nodes-base.gmailTrigger')).toBe(true);
    expect(isKnownNativeNodeForProvider('slack', 'n8n-nodes-base.slack')).toBe(true);
    expect(isKnownNativeNodeForProvider('gmail', 'n8n-nodes-base.slack')).toBe(false);
    expect(isKnownNativeNodeForProvider('fakecrmpro', 'n8n-nodes-base.fakeCrmPro')).toBe(false);
  });
});
