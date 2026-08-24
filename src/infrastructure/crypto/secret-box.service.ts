import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Encrypts and decrypts short secrets (API keys, shared secrets) at rest
 * using AES-256-GCM with an app-level key.
 *
 * Wire format: base64(iv[12] || authTag[16] || ciphertext)
 * The key is provided via CREDENTIAL_ENCRYPTION_KEY (base64-encoded, 32 bytes).
 */
@Injectable()
export class SecretBoxService implements OnModuleInit {
  private readonly logger = new Logger(SecretBoxService.name);
  private key?: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('CREDENTIAL_ENCRYPTION_KEY');
    if (!raw) {
      this.logger.warn(
        'CREDENTIAL_ENCRYPTION_KEY is not configured — secret encryption unavailable until it is set.',
      );
      return;
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `CREDENTIAL_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
      );
    }
    this.key = key;
  }

  isConfigured(): boolean {
    return this.key !== undefined;
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new Error('SecretBoxService is not configured: missing CREDENTIAL_ENCRYPTION_KEY');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(encrypted: string): string {
    if (!this.key) {
      throw new Error('SecretBoxService is not configured: missing CREDENTIAL_ENCRYPTION_KEY');
    }
    const raw = Buffer.from(encrypted, 'base64');
    if (raw.length <= IV_BYTES + 16) {
      throw new Error('Invalid encrypted payload: too short');
    }
    const iv = raw.subarray(0, IV_BYTES);
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = raw.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Auth failure (tampered payload or wrong key) — never leak internals.
      throw new Error('Decryption failed: payload tampered or wrong key');
    }
  }
}
