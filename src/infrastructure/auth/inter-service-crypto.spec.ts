import { describe, expect, it } from 'vitest';
import { computeHmacSignature, verifyHmacSignature } from './inter-service-crypto';

describe('Inter-Service Crypto', () => {
  const secret = 'super-secret-key-1234567890';
  const now = 1786971460;

  it('computes deterministic HMAC-SHA256 signature', () => {
    const sig1 = computeHmacSignature({
      secret,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'hello' },
    });

    const sig2 = computeHmacSignature({
      secret,
      timestamp: now,
      method: 'post',
      path: 'api/v1/channels/inbound',
      body: { message: 'hello' },
    });

    expect(sig1).toBe(sig2);
    expect(typeof sig1).toBe('string');
    expect(sig1.length).toBe(64); // 256 bits in hex
  });

  it('successfully verifies a valid signature within the drift window', () => {
    const signature = computeHmacSignature({
      secret,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'hello' },
    });

    const result = verifyHmacSignature({
      secret,
      signature,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'hello' },
      nowEpochSeconds: now + 50,
      maxDriftSeconds: 300,
    });

    expect(result.valid).toBe(true);
  });

  it('rejects an expired timestamp', () => {
    const signature = computeHmacSignature({
      secret,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'hello' },
    });

    const result = verifyHmacSignature({
      secret,
      signature,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'hello' },
      nowEpochSeconds: now + 400, // 400s drift > 300s max
      maxDriftSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('TIMESTAMP_EXPIRED');
  });

  it('rejects a mismatched signature if the body was altered', () => {
    const signature = computeHmacSignature({
      secret,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'hello' },
    });

    const result = verifyHmacSignature({
      secret,
      signature,
      timestamp: now,
      method: 'POST',
      path: '/api/v1/channels/inbound',
      body: { message: 'tampered' },
      nowEpochSeconds: now + 10,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SIGNATURE_MISMATCH');
  });
});
