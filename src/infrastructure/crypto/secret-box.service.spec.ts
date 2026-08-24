import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SecretBoxService } from './secret-box.service';

const KEY = randomBytes(32).toString('base64');

const service = () => {
  const config = { get: vi.fn(() => KEY) };
  const box = new SecretBoxService(config as never);
  box.onModuleInit();
  return box;
};

describe('SecretBoxService', () => {
  it('round-trips a plaintext secret', () => {
    const box = service();
    const encrypted = box.encrypt('sk-n8n-api-key-123');
    expect(encrypted).not.toContain('sk-n8n-api-key-123');
    expect(box.decrypt(encrypted)).toBe('sk-n8n-api-key-123');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const box = service();
    expect(box.encrypt('same-secret')).not.toBe(box.encrypt('same-secret'));
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const box = service();
    const encrypted = box.encrypt('secret');
    const raw = Buffer.from(encrypted, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip last ciphertext byte
    expect(() => box.decrypt(raw.toString('base64'))).toThrow(/tampered or wrong key/);
  });

  it('throws when decrypted with a different key', () => {
    const boxA = service();
    const otherKey = randomBytes(32).toString('base64');
    const configB = { get: vi.fn(() => otherKey) };
    const boxB = new SecretBoxService(configB as never);
    boxB.onModuleInit();

    const encrypted = boxA.encrypt('secret');
    expect(() => boxB.decrypt(encrypted)).toThrow(/tampered or wrong key/);
  });

  it('rejects truncated payloads', () => {
    const box = service();
    expect(() => box.decrypt(Buffer.from('tiny').toString('base64'))).toThrow(/too short/);
  });

  it('refuses to operate without a configured key', () => {
    const config = { get: vi.fn(() => undefined) };
    const box = new SecretBoxService(config as never);
    box.onModuleInit();
    expect(box.isConfigured()).toBe(false);
    expect(() => box.encrypt('x')).toThrow(/missing CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('rejects keys that do not decode to 32 bytes at init', () => {
    const config = { get: vi.fn(() => randomBytes(16).toString('base64')) };
    const box = new SecretBoxService(config as never);
    expect(() => box.onModuleInit()).toThrow(/must decode to 32 bytes/);
  });
});
