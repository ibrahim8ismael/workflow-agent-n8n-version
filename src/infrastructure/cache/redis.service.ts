import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly keyPrefix = 'woops';

  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  private prefixed(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async getValue(key: string): Promise<string | null> {
    return this.get(this.prefixed(key));
  }

  async setValue(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    if (ttlSeconds) {
      return this.set(this.prefixed(key), value, 'EX', ttlSeconds);
    }
    return this.set(this.prefixed(key), value);
  }

  async deleteValue(key: string): Promise<number> {
    return this.del(this.prefixed(key));
  }

  async existsKey(key: string): Promise<number> {
    return this.exists(this.prefixed(key));
  }

  // ── OTP ──

  async storeOtp(email: string, hashedOtp: string, ttlSeconds = 300): Promise<void> {
    const data = JSON.stringify({ hashedOtp, attempts: 0 });
    await this.set(this.prefixed(`otp:${email}`), data, 'EX', ttlSeconds);
  }

  async getOtpData(email: string): Promise<{ hashedOtp: string; attempts: number } | null> {
    const raw = await this.get(this.prefixed(`otp:${email}`));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async incrementOtpAttempts(email: string): Promise<number> {
    const data = await this.getOtpData(email);
    if (!data) return 0;
    data.attempts += 1;
    await this.set(this.prefixed(`otp:${email}`), JSON.stringify(data), 'KEEPTTL');
    return data.attempts;
  }

  async deleteOtp(email: string): Promise<void> {
    await this.del(this.prefixed(`otp:${email}`));
  }

  // ── Sessions ──

  async createSession(
    sessionId: string,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void> {
    await this.set(this.prefixed(`session:${sessionId}`), JSON.stringify(data), 'EX', ttlSeconds);
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.get(this.prefixed(`session:${sessionId}`));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.del(this.prefixed(`session:${sessionId}`));
  }

  async extendSession(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.expire(this.prefixed(`session:${sessionId}`), ttlSeconds);
  }

  // ── Rate Limiting ──

  async checkRateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const prefixedKey = this.prefixed(`ratelimit:${key}`);
    const current = await this.incr(prefixedKey);
    if (current === 1) {
      await this.expire(prefixedKey, windowSeconds);
    }
    return current <= maxRequests;
  }

  async getRemainingRateLimit(key: string, maxRequests: number): Promise<number> {
    const prefixedKey = this.prefixed(`ratelimit:${key}`);
    const current = await this.get(prefixedKey);
    if (!current) return maxRequests;
    return Math.max(0, maxRequests - parseInt(current, 10));
  }

  // ── Distributed Locks ──

  async acquireLock(lockKey: string, ttlSeconds = 10): Promise<boolean> {
    const result = await this.setnx(this.prefixed(`lock:${lockKey}`), '1');
    if (result === 1) {
      await this.expire(this.prefixed(`lock:${lockKey}`), ttlSeconds);
      return true;
    }
    return false;
  }

  async releaseLock(lockKey: string): Promise<void> {
    await this.del(this.prefixed(`lock:${lockKey}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
